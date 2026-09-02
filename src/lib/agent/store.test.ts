import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileStore, memoryStore } from "./store";
import {
  __resetGrants,
  checkAuthorization,
  consumeAuthorization,
  issueGrant,
  revokeTaskGrants,
  setGrantStore,
  type ProtectedAction,
} from "./authorization";
import {
  __resetDecisions,
  createDecisionRequest,
  pendingDecisions,
  setDecisionStore,
  submitDecision,
} from "./decisions";

// The bug this phase exists to close: jobs were persisted atomically to disk
// while grants and decisions lived in module-level Maps. Restart the runner
// mid-question and the job came back still waiting, with nothing left to
// answer it.
//
// "Restarting" here means pointing the store at the same file again, which
// clears the working set and forces a reload. That is exactly what a new
// process does, and it is the only part of a restart these modules can observe.

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "devstation-store-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  __resetGrants();
  __resetDecisions();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const action: ProtectedAction = {
  actionId: "a1",
  taskId: "task-1",
  userId: "0xowner",
  operation: "file.delete",
  resources: ["app/app.js"],
  environment: "development",
  projectId: "proj-1",
};

describe("fileStore", () => {
  it("returns null before anything has been written", () => {
    expect(fileStore(join(tempDir(), "nothing.json")).load()).toBeNull();
  });

  it("round-trips a document", () => {
    const s = fileStore(join(tempDir(), "s.json"));
    s.save('{"a":1}');
    expect(s.load()).toBe('{"a":1}');
  });

  it("replaces rather than appends on a second save", () => {
    const s = fileStore(join(tempDir(), "s.json"));
    s.save("first");
    s.save("second");
    expect(s.load()).toBe("second");
  });

  it("creates the directory it was pointed at", () => {
    const s = fileStore(join(tempDir(), "nested", "deep", "s.json"));
    s.save("x");
    expect(s.load()).toBe("x");
  });

  it("keeps a memory store isolated from disk", () => {
    const s = memoryStore();
    expect(s.load()).toBeNull();
    s.save("x");
    expect(s.load()).toBe("x");
  });
});

describe("grants across a restart", () => {
  const path = () => join(tempDir(), "grants.json");

  it("finds a grant issued by the process that died", () => {
    const p = path();
    setGrantStore(fileStore(p));
    const grant = issueGrant({ taskId: "task-1", userId: "0xowner", action, riskLevel: "high" });

    setGrantStore(fileStore(p)); // restart
    expect(checkAuthorization(grant.id, action).ok).toBe(true);
  });

  it("brings a grant back expired when it lapsed while the process was down", () => {
    const p = path();
    setGrantStore(fileStore(p));
    const grant = issueGrant({ taskId: "task-1", userId: "0xowner", action, riskLevel: "high" });

    setGrantStore(fileStore(p));
    // Nothing runs a timer; expiry is decided against the clock at read time,
    // which is what makes rehydration safe rather than a way to revive a
    // lapsed approval.
    const later = grant.expiresAt + 1;
    const result = checkAuthorization(grant.id, action, later);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("does not let a consumed grant be spent again after a restart", () => {
    const p = path();
    setGrantStore(fileStore(p));
    const grant = issueGrant({ taskId: "task-1", userId: "0xowner", action, riskLevel: "high" });
    expect(consumeAuthorization(grant.id, action).ok).toBe(true);

    setGrantStore(fileStore(p));
    const again = consumeAuthorization(grant.id, action);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe("already_consumed");
  });

  it("keeps a revocation across a restart", () => {
    const p = path();
    setGrantStore(fileStore(p));
    const grant = issueGrant({ taskId: "task-1", userId: "0xowner", action, riskLevel: "high" });
    expect(revokeTaskGrants("task-1")).toBe(1);

    setGrantStore(fileStore(p));
    const result = checkAuthorization(grant.id, action);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("revoked");
  });

  it("denies everything when the stored document is corrupt", () => {
    const p = path();
    setGrantStore(fileStore(p));
    const grant = issueGrant({ taskId: "task-1", userId: "0xowner", action, riskLevel: "high" });

    writeFileSync(p, "{ this is not json", "utf8");
    setGrantStore(fileStore(p));
    // Failing closed: an unreadable store grants nothing rather than throwing
    // on the first request after a bad write.
    expect(checkAuthorization(grant.id, action).ok).toBe(false);
  });
});

describe("decisions across a restart", () => {
  const path = () => join(tempDir(), "decisions.json");

  function ask() {
    return createDecisionRequest({
      taskId: "task-1",
      question: "Allow file.delete on app/app.js?",
      type: "confirmation",
      required: true,
      riskLevel: "medium",
      options: [
        { id: "approve", label: "Allow", value: "approve" },
        { id: "decline", label: "Do not allow", value: "decline" },
      ],
    });
  }

  it("still has the question the user was halfway through answering", () => {
    const p = path();
    setDecisionStore(fileStore(p));
    const req = ask();

    setDecisionStore(fileStore(p)); // restart
    const pending = pendingDecisions("task-1");
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(req.id);
  });

  it("accepts the answer in a process that never saw the question asked", () => {
    const p = path();
    setDecisionStore(fileStore(p));
    const req = ask();

    setDecisionStore(fileStore(p));
    const result = submitDecision({
      requestId: req.id,
      taskId: "task-1",
      clientRequestId: "click-1",
      selectedOptionIds: ["approve"],
    });
    expect(result.ok).toBe(true);
  });

  it("replays a repeated answer rather than applying it twice", () => {
    const p = path();
    setDecisionStore(fileStore(p));
    const req = ask();
    const first = submitDecision({
      requestId: req.id,
      taskId: "task-1",
      clientRequestId: "click-1",
      selectedOptionIds: ["approve"],
    });
    expect(first.ok && first.replayed).toBe(false);

    // Idempotency that forgets across a restart is not idempotency: the retry a
    // dropped connection provokes is exactly when the process has just bounced.
    setDecisionStore(fileStore(p));
    const again = submitDecision({
      requestId: req.id,
      taskId: "task-1",
      clientRequestId: "click-1",
      selectedOptionIds: ["approve"],
    });
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.replayed).toBe(true);
      expect(again.response.responseId).toBe(first.ok ? first.response.responseId : "");
    }
  });

  it("expires a question that lapsed while the process was down", () => {
    const p = path();
    setDecisionStore(fileStore(p));
    const req = createDecisionRequest({
      taskId: "task-1",
      question: "Allow it?",
      type: "confirmation",
      required: true,
      riskLevel: "medium",
      expiresAt: Date.now() + 1_000,
      options: [{ id: "approve", label: "Allow", value: "approve" }],
    });

    setDecisionStore(fileStore(p));
    expect(pendingDecisions("task-1", Date.now() + 2_000)).toHaveLength(0);
    const late = submitDecision(
      {
        requestId: req.id,
        taskId: "task-1",
        clientRequestId: "click-late",
        selectedOptionIds: ["approve"],
      },
      Date.now() + 2_000,
    );
    expect(late.ok).toBe(false);
  });
});
