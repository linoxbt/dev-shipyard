import { describe, expect, it } from "bun:test";
import { clientRequestIdFor, isSettled, type AgentPhase } from "./useAgentJob";

// Two rules from the hook that are worth more than the wiring around them, and
// that this project can test without a React renderer.

describe("isSettled", () => {
  it("does not treat a paused turn as finished", () => {
    // The bug this replaces: the poll asked `phase !== "running"`, so a turn
    // waiting on an answer was forgotten, its id dropped, and a result reported
    // for a turn that had not produced one.
    expect(isSettled("awaiting_decision")).toBe(false);
  });

  it("does not treat a running turn as finished", () => {
    expect(isSettled("running")).toBe(false);
  });

  it("treats every terminal phase as finished", () => {
    for (const phase of ["done", "error", "cancelled"] as AgentPhase[]) {
      expect(isSettled(phase)).toBe(true);
    }
  });
});

describe("clientRequestIdFor", () => {
  it("gives the same id for two clicks on one question", () => {
    const store: Record<string, string> = {};
    const first = clientRequestIdFor(store, "dec_1");
    const second = clientRequestIdFor(store, "dec_1");
    // Same id means the runner records one answer and issues one grant, however
    // many times the button is pressed.
    expect(second).toBe(first);
  });

  it("mints exactly once per question", () => {
    const store: Record<string, string> = {};
    let minted = 0;
    const mint = () => `m${++minted}`;
    clientRequestIdFor(store, "dec_1", mint);
    clientRequestIdFor(store, "dec_1", mint);
    clientRequestIdFor(store, "dec_1", mint);
    expect(minted).toBe(1);
  });

  it("gives different questions different ids", () => {
    const store: Record<string, string> = {};
    expect(clientRequestIdFor(store, "dec_1")).not.toBe(clientRequestIdFor(store, "dec_2"));
  });

  it("carries the question id, so a stray value cannot answer the wrong one", () => {
    const store: Record<string, string> = {};
    expect(clientRequestIdFor(store, "dec_abc")).toContain("dec_abc");
  });
});
