import { describe, expect, it } from "bun:test";
import { TASKS } from "./tasks";
import { mockFor, runTask } from "./runner/run";
import { compare, fingerprint, renderTable, summarise } from "./runner/report";
import type { RunReport } from "./runner/types";

// The regression suite.
//
// Every task with a script runs here, free and deterministic, through the
// MockProvider. CI picks it up through the existing `bun test` step with no
// workflow change.
//
// What it asserts is PLUMBING, not model quality: that those tool calls produce
// those file changes, those events and that verdict. Conflating the two is the
// main way a suite like this becomes theatre, so it is said here once and in
// the README. Measuring the model is what `--live` is for.

describe("every task runs green under the mock", () => {
  for (const task of TASKS) {
    const run = task.script ? it : it.skip;
    run(
      `${task.id}: ${task.title}`,
      async () => {
        const provider = mockFor(task)!;
        const attempt = await runTask(task, { provider });
        // The failing check's own name is the message, so a regression says
        // which property broke rather than "task failed".
        expect(attempt.failure).toBeNull();
        expect(attempt.passed).toBe(true);
      },
      180_000,
    );
  }
});

describe("the suite itself", () => {
  it("covers genuinely different machinery", () => {
    // Six variations on "fix this bug" would add runtime and tell you nothing.
    const capabilities = new Set(TASKS.map((t) => t.capability));
    expect(capabilities.size).toBeGreaterThanOrEqual(4);
  });

  it("gives every check a name, so a report can say what broke", () => {
    for (const task of TASKS) {
      expect(task.checks.length).toBeGreaterThan(0);
      for (const check of task.checks) expect(check.name.length).toBeGreaterThan(3);
    }
  });

  it("keeps at least one negative check per task", () => {
    // The positive ones are satisfied by an agent that met the goal any way it
    // liked, including by deleting the test.
    const negative = new Set([
      "file.unchanged",
      "files.changedOnly",
      "tool.notCalled",
      "file.absent",
    ]);
    for (const task of TASKS) {
      const has = task.checks.some((c) => negative.has(c.kind) || c.kind === "custom");
      expect(`${task.id}:${has}`).toBe(`${task.id}:true`);
    }
  });
});

describe("reporting", () => {
  const attempt = (passed: boolean, steps: number, cost: number) => ({
    passed,
    checks: [],
    steps,
    costUsd: cost,
    durationMs: 1000,
    failure: passed ? null : "something: failed",
  });

  it("reports a rate rather than a single verdict", () => {
    const task = summarise("t", "T", "edit", [
      attempt(true, 4, 0.1),
      attempt(false, 9, 0.2),
      attempt(true, 5, 0.1),
    ]);
    expect(task.passRate).toBeCloseTo(2 / 3);
    expect(task.medianSteps).toBe(5);
  });

  it("lists distinct failure reasons, not every occurrence", () => {
    const task = summarise("t", "T", "edit", [attempt(false, 1, 0), attempt(false, 1, 0)]);
    expect(task.failures).toHaveLength(1);
  });

  it("refuses to call a small move an improvement", async () => {
    // Eighteen trials cannot distinguish 67% from 100%. Saying so is the whole
    // point of having the comparison rather than eyeballing two tables.
    const base: RunReport = {
      at: "a",
      provider: "mock",
      model: "m",
      repeat: 3,
      sandbox: false,
      fingerprint: await fingerprint(),
      tasks: [
        summarise("t", "T", "edit", [
          attempt(true, 4, 0.1),
          attempt(true, 4, 0.1),
          attempt(false, 4, 0.1),
        ]),
      ],
    };
    const candidate: RunReport = {
      ...base,
      at: "b",
      tasks: [
        summarise("t", "T", "edit", [
          attempt(true, 4, 0.1),
          attempt(true, 4, 0.1),
          attempt(true, 4, 0.1),
        ]),
      ],
    };
    expect(compare(base, candidate)).toContain("within noise");
  });

  it("says BETTER only for a move that is not noise", async () => {
    const print = await fingerprint();
    const all = (passed: boolean) =>
      summarise("t", "T", "edit", [
        attempt(passed, 4, 0.1),
        attempt(passed, 4, 0.1),
        attempt(passed, 4, 0.1),
      ]);
    const base: RunReport = {
      at: "a",
      provider: "mock",
      model: "m",
      repeat: 3,
      sandbox: false,
      fingerprint: print,
      tasks: [all(false)],
    };
    const candidate: RunReport = { ...base, at: "b", tasks: [all(true)] };
    expect(compare(base, candidate)).toContain("BETTER");
  });

  it("warns when the prompt changed underneath a comparison", async () => {
    const print = await fingerprint();
    const base: RunReport = {
      at: "a",
      provider: "mock",
      model: "m",
      repeat: 1,
      sandbox: false,
      fingerprint: print,
      tasks: [],
    };
    const candidate: RunReport = {
      ...base,
      fingerprint: { ...print, systemPromptHash: "different" },
    };
    expect(compare(base, candidate)).toContain("system prompt changed");
  });

  it("renders a table that says what it is a table of", async () => {
    const report: RunReport = {
      at: new Date().toISOString(),
      provider: "mock",
      model: "mock-model",
      repeat: 1,
      sandbox: true,
      fingerprint: await fingerprint(),
      tasks: [summarise("t", "T", "edit", [attempt(true, 4, 0.1)])],
    };
    const table = renderTable(report);
    expect(table).toContain("mock/mock-model");
    expect(table).toContain("sandboxed");
    expect(table).toContain(report.fingerprint.systemPromptHash);
  });
});
