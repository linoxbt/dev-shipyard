import { describe, expect, it } from "bun:test";
import {
  ago,
  ancestorsOf,
  buildFileTree,
  compactSteps,
  latestPlan,
  backgroundTasks,
  elapsed,
  pendingQuestion,
  stepSummary,
  stepTarget,
  stepsFromEvents,
  type AgentEvent,
  compactTimeline,
  groupLabel,
  timelineFromEvents,
  timelineFromSaved,
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

describe("the timeline", () => {
  const at = "2026-10-30T00:00:00Z";
  const ev = (kind: string, message: string, tool?: string, input?: Record<string, unknown>) => ({
    kind,
    message,
    tool,
    at,
    ...(input ? { detail: { input } } : {}),
  });

  it("puts the agent's narration between its batches of work, grouped by kind", () => {
    const items = timelineFromEvents([
      ev("narration", "Reading the pages first."),
      ev("step.started", "Reading a", "read_file", { path: "src/a.ts" }),
      ev("step.completed", "Read a", "read_file", { path: "src/a.ts" }),
      ev("step.started", "Reading b", "read_file", { path: "src/b.ts" }),
      ev("step.completed", "Read b", "read_file", { path: "src/b.ts" }),
      ev("narration", "Writing the new page."),
      ev("step.started", "Writing", "write_file", { path: "src/page.tsx" }),
      ev("step.completed", "Wrote", "write_file", { path: "src/page.tsx" }),
      ev("step.started", "Running", "run_shell", { command: "npm run build" }),
    ]);
    expect(items.map((i) => (i.type === "say" ? i.text : groupLabel(i.kind, i.steps)))).toEqual([
      "Reading the pages first.",
      "Read 2 files",
      "Writing the new page.",
      "Edited page.tsx",
      "Ran npm run build",
    ]);
  });

  it("keeps narration in saved turns and reads it back the same way", () => {
    const events = [
      ev("narration", "Checking the build."),
      ev("step.started", "Running", "run_shell", { command: "npm test" }),
      ev("step.completed", "ok", "run_shell", { command: "npm test" }),
    ];
    const saved = compactTimeline(events);
    expect(saved[0]).toEqual({ tool: "narration", title: "Checking the build." });
    const back = timelineFromSaved(saved);
    expect(back[0]).toMatchObject({ type: "say", text: "Checking the build." });
    expect(back[1]).toMatchObject({ type: "group", kind: "shell" });
  });

  it("names a batch the way a person would", () => {
    const step = (tool: string, input: Record<string, unknown>) =>
      ({ id: tool, tool, title: "", status: "done", at, input }) as const;
    expect(
      groupLabel("write", [
        step("edit_file", { path: "a/App.tsx" }),
        step("write_file", { path: "a/styles.css" }),
        step("write_file", { path: "a/x.ts" }),
        step("write_file", { path: "a/y.ts" }),
      ]),
    ).toBe("Edited App.tsx, styles.css and 2 more");
    expect(groupLabel("web", [step("web_search", { query: "foundry deploy" })])).toBe(
      "Searched the web for “foundry deploy”",
    );
    expect(groupLabel("read", [step("read_file", { path: "src/index.ts" })])).toBe("Read index.ts");
  });
});

describe("pendingQuestion", () => {
  const asked = ev("question", "Where should I deploy it?", {
    tool: "ask_user",
    detail: {
      question: "Where should I deploy it?",
      options: [{ label: "Vercel" }, { label: "Netlify", description: "Drag and drop" }],
    },
  });

  it("finds the question a turn ended on", () => {
    expect(pendingQuestion([asked, ev("usage", "x"), ev("task.completed", "x")])).toEqual({
      question: "Where should I deploy it?",
      options: [{ label: "Vercel" }, { label: "Netlify", description: "Drag and drop" }],
    });
  });

  it("ignores a question the agent moved past, and one without real choices", () => {
    expect(pendingQuestion([asked, ev("step.started", "Reading", { tool: "read_file" })])).toBe(
      null,
    );
    expect(
      pendingQuestion([ev("question", "Which?", { detail: { options: [{ label: "Only" }] } })]),
    ).toBe(null);
  });

  it("is not shown as a step", () => {
    expect(stepsFromEvents([asked])).toEqual([]);
  });
});

describe("the running line", () => {
  it("counts background commands that are still running", () => {
    const started = (n: number) =>
      ev("step.completed", `bg-${n}`, {
        tool: "run_shell",
        detail: { input: { command: "npm run dev", background: true } },
      });
    expect(backgroundTasks([started(1), started(2)])).toBe(2);
    expect(
      backgroundTasks([started(1), started(2), ev("step.completed", "x", { tool: "stop_shell" })]),
    ).toBe(1);
    expect(
      backgroundTasks([
        ev("step.completed", "x", { tool: "run_shell", detail: { input: { command: "ls" } } }),
      ]),
    ).toBe(0);
  });

  it("says how long the agent has been working", () => {
    expect(elapsed(45_000)).toBe("45s");
    expect(elapsed(192_000)).toBe("3m 12s");
    expect(elapsed(3_840_000)).toBe("1h 04m");
  });

  it("keeps a screenshot on its step", () => {
    const steps = stepsFromEvents([
      ev("step.started", "Taking a screenshot", { tool: "screenshot" }),
      ev("step.completed", "Screenshot", { tool: "screenshot", detail: { shot: "shot-ab-1" } }),
    ]);
    expect(steps[0].shot).toBe("shot-ab-1");
    expect(
      compactTimeline([
        ev("step.started", "Taking a screenshot", { tool: "screenshot" }),
        ev("step.completed", "Screenshot", { tool: "screenshot", detail: { shot: "shot-ab-1" } }),
      ])[0].shot,
    ).toBe("shot-ab-1");
    expect(groupLabel("browser", steps)).toBe("Took a screenshot");
  });
});
