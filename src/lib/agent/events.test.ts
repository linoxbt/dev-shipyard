import { describe, expect, it } from "bun:test";
import { TaskLog, canTransition, inspectSequence } from "./events";

describe("sequencing", () => {
  it("increases by exactly one, so a gap is detectable", () => {
    const log = new TaskLog("task_1", "conv_1");
    const seqs = [
      log.emit("agent.started").sequence,
      log.emit("agent.message").sequence,
      log.emit("agent.completed").sequence,
    ];
    expect(seqs).toEqual([1, 2, 3]);
    expect(log.lastSequence).toBe(3);
  });

  it("replays only what a reconnecting client is missing", () => {
    const log = new TaskLog("task_1", "conv_1");
    for (let i = 0; i < 5; i++) log.emit("agent.message", { i });
    // The client says "I have up to 2".
    expect(log.since(2).map((e) => e.sequence)).toEqual([3, 4, 5]);
  });

  it("flags a gap rather than rendering stale state", () => {
    expect(inspectSequence([10, 12])).toEqual({ ok: false, missing: [11], duplicates: [] });
  });

  it("flags a duplicate", () => {
    const r = inspectSequence([10, 11, 11]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.duplicates).toEqual([11]);
  });

  it("accepts an in-order run, including out-of-order arrival that is complete", () => {
    expect(inspectSequence([10, 11, 12])).toEqual({ ok: true });
    // Arrival order does not matter; completeness does.
    expect(inspectSequence([10, 12, 11])).toEqual({ ok: true });
  });
});

describe("the state machine", () => {
  it("lets a waiting task resume — the whole point of a checkpoint", () => {
    expect(canTransition("waiting_for_user", "running")).toBe(true);
  });

  it("refuses to revive a finished task", () => {
    for (const from of ["completed", "cancelled", "failed"] as const) {
      expect(canTransition(from, "running")).toBe(false);
    }
  });

  it("rejects an illegal transition instead of obeying it", () => {
    const log = new TaskLog("task_1", "conv_1");
    expect(log.transition("completed")).toBe(true);
    expect(log.transition("running")).toBe(false);
    expect(log.status).toBe("completed");
  });

  it("records each accepted transition as an event", () => {
    const log = new TaskLog("task_1", "conv_1");
    log.transition("waiting_for_user");
    log.transition("running");
    const kinds = log.all().map((e) => e.type);
    expect(kinds.filter((k) => k === "agent.state_changed")).toHaveLength(2);
  });
});

describe("events never carry secrets", () => {
  it("redacts a credential put into a payload", () => {
    const log = new TaskLog("task_1", "conv_1");
    const e = log.emit("agent.message", {
      text: "use ghp_AbCdEfGhIjKlMnOpQrStUvWxYz012345 to push",
    });
    expect(JSON.stringify(e.payload)).not.toContain("ghp_");
    expect(JSON.stringify(e.payload)).toContain("[redacted]");
  });

  it("redacts one nested inside structured payloads", () => {
    const log = new TaskLog("task_1", "conv_1");
    const e = log.emit("agent.action.completed", {
      env: { DATABASE_PASSWORD: "sup3rsecretvalue" },
    });
    expect(JSON.stringify(e.payload)).not.toContain("sup3rsecretvalue");
  });
});

describe("event identity", () => {
  it("distinguishes a question from a failure from a completion", () => {
    const log = new TaskLog("task_1", "conv_1");
    const kinds = [
      log.emit("agent.decision.requested").type,
      log.emit("agent.action.failed").type,
      log.emit("agent.completed").type,
    ];
    expect(new Set(kinds).size).toBe(3);
  });
});
