import { describe, expect, it, beforeEach } from "bun:test";
import {
  AUTHORIZATION_TTL_MS,
  __resetGrants,
  actionFingerprint,
  checkAuthorization,
  consumeAuthorization,
  issueGrant,
  revokeTaskGrants,
  type ProtectedAction,
} from "./authorization";

// Every test here asserts that a privileged action is REFUSED. The agent
// proposes; this layer decides, and an unknown state must be a denial.

const base: ProtectedAction = {
  actionId: "act_1",
  taskId: "task_1",
  userId: "user_1",
  operation: "database.migration",
  resources: ["users_table"],
  environment: "production",
  projectId: "project_A",
};

const grantFor = (a: ProtectedAction = base, now?: number) =>
  issueGrant({ taskId: a.taskId, userId: a.userId, action: a, riskLevel: "high", now });

beforeEach(__resetGrants);

describe("the happy path", () => {
  it("permits exactly the action that was approved", () => {
    const g = grantFor();
    expect(checkAuthorization(g.id, base).ok).toBe(true);
  });
});

describe("unauthorized execution", () => {
  it("refuses with no grant at all", () => {
    expect(checkAuthorization(undefined, base)).toEqual({ ok: false, reason: "no_grant" });
  });

  it("refuses a grant id that does not exist", () => {
    expect(checkAuthorization("grant_made_up", base)).toEqual({ ok: false, reason: "no_grant" });
  });
});

describe("scope is least-privilege", () => {
  it("approving a migration does not authorize a delete", () => {
    const g = grantFor();
    const check = checkAuthorization(g.id, { ...base, operation: "database.delete" });
    expect(check).toEqual({ ok: false, reason: "wrong_operation" });
  });

  it("approving users_table does not authorize payments_table", () => {
    const g = grantFor();
    const check = checkAuthorization(g.id, { ...base, resources: ["payments_table"] });
    expect(check).toEqual({ ok: false, reason: "resource_not_covered" });
  });

  it("refuses when only SOME resources were approved", () => {
    const g = grantFor();
    const check = checkAuthorization(g.id, {
      ...base,
      resources: ["users_table", "payments_table"],
    });
    expect(check).toEqual({ ok: false, reason: "resource_not_covered" });
  });

  it("refuses a different project", () => {
    const g = grantFor();
    expect(checkAuthorization(g.id, { ...base, projectId: "project_B" })).toEqual({
      ok: false,
      reason: "wrong_project",
    });
  });

  it("refuses a different environment", () => {
    const g = grantFor();
    expect(checkAuthorization(g.id, { ...base, environment: "development" })).toEqual({
      ok: false,
      reason: "wrong_environment",
    });
  });

  it("refuses a different user", () => {
    const g = grantFor();
    expect(checkAuthorization(g.id, { ...base, userId: "user_2" })).toEqual({
      ok: false,
      reason: "wrong_user",
    });
  });

  it("refuses a different task", () => {
    const g = grantFor();
    expect(checkAuthorization(g.id, { ...base, taskId: "task_2" })).toEqual({
      ok: false,
      reason: "wrong_task",
    });
  });
});

describe("expiry uses server time", () => {
  it("refuses once the window has passed", () => {
    const now = 1_000_000;
    const g = grantFor(base, now);
    const afterExpiry = now + AUTHORIZATION_TTL_MS.high + 1;
    expect(checkAuthorization(g.id, base, afterExpiry)).toEqual({ ok: false, reason: "expired" });
  });

  it("gives a critical action the shortest window", () => {
    expect(AUTHORIZATION_TTL_MS.critical).toBeLessThan(AUTHORIZATION_TTL_MS.high);
    expect(AUTHORIZATION_TTL_MS.high).toBeLessThan(AUTHORIZATION_TTL_MS.medium);
  });

  it("stays expired once it has lapsed, even if asked again earlier", () => {
    const now = 1_000_000;
    const g = grantFor(base, now);
    checkAuthorization(g.id, base, now + AUTHORIZATION_TTL_MS.high + 1);
    // A replayed request with an earlier clock must not resurrect it.
    expect(checkAuthorization(g.id, base, now + 5).ok).toBe(false);
  });
});

describe("single use prevents replay", () => {
  it("consumes the grant, so the same approval cannot run twice", () => {
    const g = grantFor();
    expect(consumeAuthorization(g.id, base).ok).toBe(true);
    expect(consumeAuthorization(g.id, base)).toEqual({ ok: false, reason: "already_consumed" });
  });

  it("two concurrent workers cannot both pass on one grant", () => {
    const g = grantFor();
    const results = [consumeAuthorization(g.id, base), consumeAuthorization(g.id, base)];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("revocation", () => {
  it("cancelling a task kills its active grants", () => {
    const g = grantFor();
    expect(revokeTaskGrants("task_1")).toBe(1);
    expect(checkAuthorization(g.id, base)).toEqual({ ok: false, reason: "revoked" });
  });

  it("leaves another task's grants alone", () => {
    const other: ProtectedAction = { ...base, taskId: "task_2" };
    const g2 = grantFor(other);
    revokeTaskGrants("task_1");
    expect(checkAuthorization(g2.id, other).ok).toBe(true);
  });
});

describe("fingerprint binding", () => {
  it("a materially changed action invalidates the approval", () => {
    // "Deploy build A" must not authorize deploying build B.
    const deployA: ProtectedAction = {
      ...base,
      operation: "deploy.publish",
      resources: ["site"],
      parameters: { commit: "aaaaaaa" },
    };
    const g = issueGrant({
      taskId: deployA.taskId,
      userId: deployA.userId,
      action: deployA,
      riskLevel: "critical",
    });
    const deployB = { ...deployA, parameters: { commit: "bbbbbbb" } };
    expect(checkAuthorization(g.id, deployB)).toEqual({
      ok: false,
      reason: "fingerprint_mismatch",
    });
  });

  it("is stable across key order, so an equivalent action still matches", () => {
    const a: ProtectedAction = { ...base, parameters: { x: 1, y: { b: 2, a: 1 } } };
    const b: ProtectedAction = { ...base, parameters: { y: { a: 1, b: 2 }, x: 1 } };
    expect(actionFingerprint(a)).toBe(actionFingerprint(b));
  });

  it("changes when the resource changes", () => {
    expect(actionFingerprint(base)).not.toBe(
      actionFingerprint({ ...base, resources: ["payments_table"] }),
    );
  });
});
