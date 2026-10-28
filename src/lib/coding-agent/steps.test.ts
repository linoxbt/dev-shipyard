import { describe, expect, it } from "bun:test";
import {
  ago,
  ancestorsOf,
  buildFileTree,
  compactSteps,
  latestPlan,
  stepSummary,
  stepTarget,
  stepsFromEvents,
  type AgentEvent,
} from "./steps";

const at = "2026-10-28T12:00:00.000Z";
const ev = (kind: string, message: string, extra: Partial<AgentEvent> = {}): AgentEvent => ({
  kind,
  message,
  at,
  ...extra,
});

describe("stepsFromEvents", () => {
  it("pairs each start with its result and keeps the command's output", () => {
    const steps = stepsFromEvents([
      ev("step.started", "Running bun test", {
        tool: "run_shell",
        detail: { input: { command: "bun test" } },
      }),
      ev("step.completed", "exit 0", {
        tool: "run_shell",
        ok: true,
        detail: { input: { command: "bun test" }, output: "3 pass" },
      }),
      ev("step.started", "Writing app/index.html", {
        tool: "write_file",
        detail: { input: { path: "app/index.html" } },
      }),
    ]);
    expect(steps.map((s) => [s.tool, s.status])).toEqual([
      ["run_shell", "done"],
      ["write_file", "running"],
    ]);
    expect(steps[0].output).toBe("3 pass");
    expect(stepTarget(steps[0])).toBe("bun test");
  });

  it("marks failures, keeps notes, and drops bookkeeping and the plan tool", () => {
    const steps = stepsFromEvents([
      ev("usage", "100 tokens"),
      ev("step.started", "Updating the plan", { tool: "update_plan" }),
      ev("step.completed", "ok", { tool: "update_plan" }),
      ev("step.started", "Patching a.ts", { tool: "edit_file" }),
      ev("step.failed", "hunk did not apply", { tool: "edit_file" }),
      ev("approval.denied", "run_shell was not allowed.", { tool: "run_shell" }),
      ev("task.completed", "Done."),
    ]);
    expect(steps.map((s) => s.status)).toEqual(["failed", "note"]);
    expect(steps[0].title).toContain("hunk did not apply");
    expect(steps[1].tone).toBe("warning");
  });

  it("still shows a result whose start was trimmed from the stream", () => {
    const steps = stepsFromEvents([ev("step.failed", "refused", { tool: "git" })]);
    expect(steps).toHaveLength(1);
    expect(steps[0].status).toBe("failed");
  });
});

describe("latestPlan", () => {
  it("returns the newest valid checklist", () => {
    const plan = (items: unknown) =>
      ev("step.started", "Updating the plan", {
        tool: "update_plan",
        detail: { input: { plan: items } },
      });
    expect(
      latestPlan([
        plan([{ step: "old", status: "completed" }]),
        plan([
          { step: "Scaffold", status: "completed" },
          { step: "Wire the contract", status: "in_progress" },
          { step: 3, status: "nonsense" },
        ]),
      ]),
    ).toEqual([
      { step: "Scaffold", status: "completed" },
      { step: "Wire the contract", status: "in_progress" },
    ]);
    expect(latestPlan([])).toBeNull();
  });
});

describe("stepSummary and compactSteps", () => {
  it("says what a turn did in one line", () => {
    const steps = [
      { tool: "write_file", status: "done" as const },
      { tool: "edit_file", status: "done" as const },
      { tool: "run_shell", status: "failed" as const },
      { tool: null, status: "note" as const },
    ];
    expect(stepSummary(steps)).toBe("Edited 2 files, ran 1 command · 1 failed");
    expect(stepSummary([])).toBe("");
  });

  it("keeps titles only, so browser storage stays small", () => {
    const saved = compactSteps(
      stepsFromEvents([
        ev("step.started", "Running x", { tool: "run_shell" }),
        ev("step.failed", "boom", { tool: "run_shell", detail: { output: "x".repeat(9000) } }),
      ]),
    );
    expect(saved).toEqual([{ tool: "run_shell", title: "Running x: boom", failed: true }]);
  });
});

describe("buildFileTree", () => {
  it("nests folders first, alphabetically", () => {
    const tree = buildFileTree(["src/b.ts", "README.md", "src/a/x.ts", "src/a.ts", "app.js"]);
    expect(tree.map((n) => n.name)).toEqual(["src", "app.js", "README.md"]);
    expect(tree[0].children!.map((n) => n.name)).toEqual(["a", "a.ts", "b.ts"]);
    expect(tree[0].children![0].children![0].path).toBe("src/a/x.ts");
  });

  it("lists the folders above a file", () => {
    expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
    expect(ancestorsOf("c.ts")).toEqual([]);
  });
});

describe("ago", () => {
  it("is short", () => {
    const now = 1_000_000_000_000;
    expect(ago(now - 10_000, now)).toBe("just now");
    expect(ago(now - 5 * 60_000, now)).toBe("5m ago");
    expect(ago(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(ago(now - 2 * 86_400_000, now)).toBe("2d ago");
  });
});
