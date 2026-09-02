import { randomUUID } from "node:crypto";
import type { RiskLevel } from "./authorization";
import type { PersistentStore } from "./store";

// Decision requests and the user's answers.
//
// A decision is a checkpoint, not the end of a task. The store here exists so
// that an answer can be validated server-side and applied EXACTLY ONCE, however
// many times the browser sends it — a double click, a retry after a dropped
// connection, or a reconnect must never run a destructive action twice.
//
// Options carry stable ids. The label is display text and may be reworded or
// translated; matching on it would silently change what an answer means.

export type DecisionType = "single_select" | "multi_select" | "confirmation" | "text" | "approval";

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  value: string;
  riskLevel?: RiskLevel;
}

export interface DecisionRequest {
  id: string;
  taskId: string;
  question: string;
  description?: string;
  type: DecisionType;
  options?: DecisionOption[];
  required: boolean;
  riskLevel: RiskLevel;
  /** Absolute ms, server clock. */
  expiresAt?: number;
  affectedAction?: string;
  /** What actually happens if they say yes — "are you sure?" is not enough. */
  consequences?: string;
  allowCustomResponse?: boolean;
  status: "pending" | "answered" | "expired" | "cancelled";
  createdAt: number;
}

export interface DecisionResponse {
  requestId: string;
  taskId: string;
  responseId: string;
  selectedOptionIds?: string[];
  text?: string;
  submittedAt: number;
  /** Supplied by the client and used for idempotency. */
  clientRequestId: string;
}

export type DecisionDenial =
  | "unknown_request"
  | "wrong_task"
  | "not_pending"
  | "expired"
  | "unknown_option"
  | "wrong_selection_count"
  | "selection_not_allowed"
  | "text_required";

export type DecisionResult =
  | { ok: true; response: DecisionResponse; replayed: boolean; request: DecisionRequest }
  | { ok: false; reason: DecisionDenial };

const requests = new Map<string, DecisionRequest>();
/** clientRequestId -> the result already produced for it. */
const processed = new Map<string, DecisionResponse>();

// Durability, for the same reason as grants: a question the user was halfway
// through answering must still be there after a restart.
//
// `processed` is persisted alongside the requests, not treated as a cache. It
// is what makes an answer apply exactly once, and idempotency that forgets
// across a restart is not idempotency — the retry a dropped connection
// provokes is exactly when the process is most likely to have bounced.
let store: PersistentStore | null = null;
let loaded = false;

interface DecisionDocument {
  requests: DecisionRequest[];
  processed: Array<[string, DecisionResponse]>;
}

/** Point the decision store at durable storage. Called once by the runner at
 *  startup, and by tests with a temporary file. */
export function setDecisionStore(next: PersistentStore | null): void {
  store = next;
  loaded = false;
  requests.clear();
  processed.clear();
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  if (!store) return;
  const raw = store.load();
  if (!raw) return;
  try {
    const doc = JSON.parse(raw) as DecisionDocument;
    for (const r of doc.requests ?? []) requests.set(r.id, r);
    for (const [k, v] of doc.processed ?? []) processed.set(k, v);
  } catch {
    // An unparseable store leaves both empty. Every request then reads as
    // unknown, which refuses rather than approves.
  }
}

function flush(): void {
  if (!store) return;
  const doc: DecisionDocument = {
    requests: [...requests.values()],
    processed: [...processed.entries()],
  };
  store.save(JSON.stringify(doc));
}

export function createDecisionRequest(
  input: Omit<DecisionRequest, "id" | "status" | "createdAt"> & { id?: string },
): DecisionRequest {
  const req: DecisionRequest = {
    ...input,
    id: input.id ?? `dec_${randomUUID()}`,
    status: "pending",
    createdAt: Date.now(),
  };
  ensureLoaded();
  requests.set(req.id, req);
  flush();
  return req;
}

export function getDecisionRequest(id: string): DecisionRequest | undefined {
  ensureLoaded();
  return requests.get(id);
}

/** Pending requests for a task, so a reconnecting client can render them. */
export function pendingDecisions(taskId: string, now = Date.now()): DecisionRequest[] {
  ensureLoaded();
  let changed = false;
  const out: DecisionRequest[] = [];
  for (const r of requests.values()) {
    if (r.taskId !== taskId) continue;
    if (r.status !== "pending") continue;
    if (r.expiresAt && r.expiresAt <= now) {
      r.status = "expired";
      changed = true;
      continue;
    }
    out.push(r);
  }
  if (changed) flush();
  return out;
}

/** Expire anything past its window. The agent must NOT quietly perform the
 *  action a lapsed confirmation was gating. */
export function expireDecisions(taskId: string, now = Date.now()): DecisionRequest[] {
  ensureLoaded();
  const expired: DecisionRequest[] = [];
  for (const r of requests.values()) {
    if (r.taskId === taskId && r.status === "pending" && r.expiresAt && r.expiresAt <= now) {
      r.status = "expired";
      expired.push(r);
    }
  }
  if (expired.length) flush();
  return expired;
}

export function cancelDecisions(taskId: string): number {
  ensureLoaded();
  let n = 0;
  for (const r of requests.values()) {
    if (r.taskId === taskId && r.status === "pending") {
      r.status = "cancelled";
      n++;
    }
  }
  if (n) flush();
  return n;
}

/** Validate and record an answer.
 *
 *  Nothing the client sends is trusted: the request must exist, belong to this
 *  task, still be pending, be unexpired, and the chosen option ids must be ones
 *  this request actually offered. */
export function submitDecision(
  input: Omit<DecisionResponse, "responseId" | "submittedAt"> & { submittedAt?: number },
  now = Date.now(),
): DecisionResult {
  ensureLoaded();
  // Idempotency first: a replay must return the original outcome without
  // re-validating against a request that is no longer pending.
  const seen = processed.get(input.clientRequestId);
  if (seen) {
    const req = requests.get(seen.requestId)!;
    return { ok: true, response: seen, replayed: true, request: req };
  }

  const req = requests.get(input.requestId);
  if (!req) return { ok: false, reason: "unknown_request" };
  if (req.taskId !== input.taskId) return { ok: false, reason: "wrong_task" };
  if (req.expiresAt && req.expiresAt <= now) {
    req.status = "expired";
    flush();
    return { ok: false, reason: "expired" };
  }
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };

  const ids = input.selectedOptionIds ?? [];
  const offered = new Set((req.options ?? []).map((o) => o.id));
  for (const id of ids) {
    if (!offered.has(id)) return { ok: false, reason: "unknown_option" };
  }

  switch (req.type) {
    case "single_select":
    case "confirmation":
    case "approval":
      if (ids.length !== 1) {
        // A custom answer is only acceptable when the request invited one.
        if (!(req.allowCustomResponse && input.text?.trim())) {
          return { ok: false, reason: "wrong_selection_count" };
        }
      }
      break;
    case "multi_select":
      if (ids.length === 0 && !(req.allowCustomResponse && input.text?.trim())) {
        return { ok: false, reason: "wrong_selection_count" };
      }
      break;
    case "text":
      if (ids.length > 0) return { ok: false, reason: "selection_not_allowed" };
      if (!input.text?.trim()) return { ok: false, reason: "text_required" };
      break;
  }

  const response: DecisionResponse = {
    ...input,
    responseId: `res_${randomUUID()}`,
    submittedAt: input.submittedAt ?? now,
  };
  req.status = "answered";
  processed.set(input.clientRequestId, response);
  flush();
  return { ok: true, response, replayed: false, request: req };
}

/** The chosen options, resolved back to what they meant. */
export function selectedOptions(req: DecisionRequest, res: DecisionResponse): DecisionOption[] {
  const byId = new Map((req.options ?? []).map((o) => [o.id, o]));
  return (res.selectedOptionIds ?? []).flatMap((id) => {
    const o = byId.get(id);
    return o ? [o] : [];
  });
}

/** Test seam only. */
export function __resetDecisions(): void {
  requests.clear();
  processed.clear();
  store = null;
  loaded = false;
}
