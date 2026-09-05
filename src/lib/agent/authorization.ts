import { createHash, randomUUID } from "node:crypto";
import type { PersistentStore } from "./store";

// The authorization boundary for privileged agent actions.
//
// The model proposes; this decides. Nothing here trusts the agent's own claim
// that something was approved: a grant is a server-side record, and a tool may
// only run when a grant is found that matches the action about to happen.
//
// The properties this file exists to guarantee, each covered by a test:
//   - least privilege: a grant names one operation on named resources
//   - expiry: server clock only, never the client's
//   - single use: consumed when the action begins, so it cannot be replayed
//   - binding: a grant is tied to user, task, project and environment
//   - fingerprint: if the action materially changes, the grant stops matching
//   - revocation: cancelling a task kills its grants
//
// Every check FAILS CLOSED. An unknown state is a denial.

export type RiskLevel = "low" | "medium" | "high" | "critical";

/** How long a grant stays usable, by risk. Deliberately short: an approval is
 *  permission to do one thing now, not standing authority. */
export const AUTHORIZATION_TTL_MS: Record<Exclude<RiskLevel, "low">, number> = {
  medium: 15 * 60 * 1000,
  high: 10 * 60 * 1000,
  critical: 5 * 60 * 1000,
};

export interface AuthorizationScope {
  /** Dotted action name, e.g. "database.migration", "deploy.publish". */
  operation: string;
  /** The exact things the user agreed may be touched. */
  resources: string[];
  environment?: "development" | "preview" | "production";
  projectId: string;
  constraints?: Record<string, unknown>;
}

export interface AuthorizationGrant {
  id: string;
  taskId: string;
  userId: string;
  actionId: string;
  scope: AuthorizationScope;
  riskLevel: Exclude<RiskLevel, "low">;
  issuedAt: number;
  expiresAt: number;
  status: "active" | "consumed" | "expired" | "revoked";
  issuedFromDecisionRequestId?: string;
  consumedAt?: number;
  /** Hash of what was approved. A materially different action will not match. */
  fingerprint: string;
}

/** What a tool is about to do, described well enough to authorize. */
export interface ProtectedAction {
  actionId: string;
  taskId: string;
  userId: string;
  operation: string;
  resources: string[];
  environment?: "development" | "preview" | "production";
  projectId: string;
  /** Anything that would make this a materially different action. */
  parameters?: Record<string, unknown>;
}

/** A stable hash of the action's identity.
 *
 *  Approving "deploy build A to production" must not authorize deploying build
 *  B. Keys are sorted so an equivalent action always hashes the same. */
export function actionFingerprint(a: ProtectedAction): string {
  const canonical = JSON.stringify({
    operation: a.operation,
    projectId: a.projectId,
    environment: a.environment ?? null,
    resources: [...a.resources].sort(),
    parameters: sortedEntries(a.parameters ?? {}),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

function sortedEntries(o: Record<string, unknown>): Array<[string, unknown]> {
  return Object.entries(o)
    .map(
      ([k, v]) =>
        [
          k,
          v && typeof v === "object" && !Array.isArray(v)
            ? sortedEntries(v as Record<string, unknown>)
            : v,
        ] as [string, unknown],
    )
    .sort((x, y) => x[0].localeCompare(y[0]));
}

export type DenialReason =
  | "no_grant"
  | "expired"
  | "revoked"
  | "already_consumed"
  | "wrong_user"
  | "wrong_task"
  | "wrong_project"
  | "wrong_environment"
  | "wrong_operation"
  | "resource_not_covered"
  | "fingerprint_mismatch";

export type AuthorizationCheck =
  | { ok: true; grant: AuthorizationGrant }
  | { ok: false; reason: DenialReason };

/** The working set. The runner is a single long-lived process, so this is the
 *  authoritative record; it is deliberately NOT reachable from the browser. */
const grants = new Map<string, AuthorizationGrant>();

// Durability. Without it a restart lost every grant while the jobs that were
// waiting on them survived on disk: a task that could never be answered.
//
// Nothing here starts a timer. Expiry is decided by comparing expiresAt to the
// clock at the moment a grant is READ, which is what makes a rehydrated grant
// safe: a grant that lapsed while the process was down comes back as expired
// the first time anything looks at it, rather than resuming its old life.
let store: PersistentStore | null = null;
let loaded = false;

/** Point the grant store at durable storage. Called once by the runner at
 *  startup, and by tests with a temporary file. Passing null returns to
 *  memory-only, which is how the browser bundle would behave if it ever
 *  reached this code. */
export function setGrantStore(next: PersistentStore | null): void {
  store = next;
  loaded = false;
  grants.clear();
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (!store) return;
  const raw = store.load();
  if (!raw) return;
  try {
    for (const g of JSON.parse(raw) as AuthorizationGrant[]) grants.set(g.id, g);
  } catch {
    // An unparseable store denies everything, which is the safe direction.
  }
}

function flush(): void {
  store?.save(JSON.stringify([...grants.values()]));
}

export function issueGrant(params: {
  taskId: string;
  userId: string;
  action: ProtectedAction;
  riskLevel: Exclude<RiskLevel, "low">;
  issuedFromDecisionRequestId?: string;
  now?: number;
}): AuthorizationGrant {
  const now = params.now ?? Date.now();
  const grant: AuthorizationGrant = {
    id: `grant_${randomUUID()}`,
    taskId: params.taskId,
    userId: params.userId,
    actionId: params.action.actionId,
    scope: {
      operation: params.action.operation,
      resources: [...params.action.resources],
      environment: params.action.environment,
      projectId: params.action.projectId,
    },
    riskLevel: params.riskLevel,
    issuedAt: now,
    expiresAt: now + AUTHORIZATION_TTL_MS[params.riskLevel],
    status: "active",
    issuedFromDecisionRequestId: params.issuedFromDecisionRequestId,
    fingerprint: actionFingerprint(params.action),
  };
  ensureLoaded();
  grants.set(grant.id, grant);
  flush();
  return grant;
}

/** Every condition, evaluated server-side, before a protected tool may run.
 *
 *  Called immediately before execution: never only when the confirmation UI is
 *  rendered, which would leave a window where the grant expires or is revoked
 *  between the click and the action. */
export function checkAuthorization(
  grantId: string | undefined,
  action: ProtectedAction,
  now = Date.now(),
): AuthorizationCheck {
  if (!grantId) return { ok: false, reason: "no_grant" };
  ensureLoaded();
  const g = grants.get(grantId);
  if (!g) return { ok: false, reason: "no_grant" };

  if (g.status === "revoked") return { ok: false, reason: "revoked" };
  if (g.status === "consumed") return { ok: false, reason: "already_consumed" };
  // Server time, always. A client cannot extend its own approval.
  if (g.expiresAt <= now) {
    g.status = "expired";
    flush();
    return { ok: false, reason: "expired" };
  }
  if (g.status === "expired") return { ok: false, reason: "expired" };

  if (g.userId !== action.userId) return { ok: false, reason: "wrong_user" };
  if (g.taskId !== action.taskId) return { ok: false, reason: "wrong_task" };
  if (g.scope.projectId !== action.projectId) return { ok: false, reason: "wrong_project" };
  if (g.scope.operation !== action.operation) return { ok: false, reason: "wrong_operation" };
  if ((g.scope.environment ?? null) !== (action.environment ?? null)) {
    return { ok: false, reason: "wrong_environment" };
  }
  // Every resource touched must be one the user actually saw and approved.
  const covered = new Set(g.scope.resources);
  if (!action.resources.every((r) => covered.has(r))) {
    return { ok: false, reason: "resource_not_covered" };
  }
  if (g.fingerprint !== actionFingerprint(action)) {
    return { ok: false, reason: "fingerprint_mismatch" };
  }
  return { ok: true, grant: g };
}

/** Check and consume in one step, so two concurrent workers cannot both pass.
 *
 *  Single-threaded JS makes this atomic here; on a multi-process deployment the
 *  same shape maps onto a conditional update. */
export function consumeAuthorization(
  grantId: string | undefined,
  action: ProtectedAction,
  now = Date.now(),
): AuthorizationCheck {
  const result = checkAuthorization(grantId, action, now);
  if (!result.ok) return result;
  result.grant.status = "consumed";
  result.grant.consumedAt = now;
  flush();
  return result;
}

/** Cancelling a task must not leave live approvals behind. */
export function revokeTaskGrants(taskId: string): number {
  ensureLoaded();
  let n = 0;
  for (const g of grants.values()) {
    if (g.taskId === taskId && g.status === "active") {
      g.status = "revoked";
      n++;
    }
  }
  if (n) flush();
  return n;
}

export function getGrant(id: string): AuthorizationGrant | undefined {
  ensureLoaded();
  return grants.get(id);
}

/** Test seam only. */
export function __resetGrants(): void {
  grants.clear();
  store = null;
  loaded = false;
}
