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

describe("compactSteps", () => {
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

  it("keeps a shared file on its step, and drops one that is malformed", () => {
    const media = {
      id: "media-mvw42o5uab12cd34",
      name: "launch.mp4",
      size: 18_000_000,
      type: "video/mp4",
      kind: "video",
      caption: "The 30 second cut",
    };
    const events = [
      ev("step.started", "Sharing launch.mp4", { tool: "share_file" }),
      ev("step.completed", "Shared launch.mp4", { tool: "share_file", detail: { media } }),
    ];
    const steps = stepsFromEvents(events);
    expect(steps[0].media).toEqual(media as never);
    expect(compactTimeline(events)[0].media).toEqual(media as never);
    expect(groupLabel("share", steps)).toBe("Shared launch.mp4");
    const bad = stepsFromEvents([
      ev("step.started", "Sharing", { tool: "share_file" }),
      ev("step.completed", "Shared", {
        tool: "share_file",
        detail: { media: { ...media, id: "../../etc/passwd" } },
      }),
    ]);
    expect(bad[0].media).toBeUndefined();
  });
});

describe("commands as a person reads them", () => {
  it("cleans a step's own title too, saved ones included", async () => {
    const { readableTitle, timelineFromSaved } = await import("./steps");
    expect(
      readableTitle("Running cd /vercel/devstation/state/workspaces/ws-1 && npm install"),
    ).toBe("Running npm install");
    expect(readableTitle("Running the tests")).toBe("Running the tests");
    expect(readableTitle("Reading src/app.ts")).toBe("Reading src/app.ts");
    const [group] = timelineFromSaved([
      { tool: "run_shell", title: "Running cd /vercel/devstation/state/workspaces/ws-1 && ls" },
    ]);
    expect(group.type === "group" && group.steps[0].title).toBe("Running ls");
  });

  it("drops the cd into the project and the machine's paths", async () => {
    const { cleanCommand } = await import("./steps");
    expect(
      cleanCommand("cd /vercel/devstation/state/workspaces/ws-bc54328a && npx playwright test"),
    ).toBe("npx playwright test");
    expect(cleanCommand("cd /vercel/devstation/state/workspaces/ws-1/app && npm run build")).toBe(
      "npm run build",
    );
    expect(cleanCommand("cat /vercel/devstation/state/workspaces/ws-1/src/app.ts")).toBe(
      "cat src/app.ts",
    );
    expect(cleanCommand("ls -la")).toBe("ls -la");
    expect(
      groupLabel("shell", [
        {
          id: "1",
          tool: "run_shell",
          title: "x",
          status: "done",
          at: "",
          input: { command: "cd /vercel/devstation/state/workspaces/ws-9 && node debug.mjs" },
        },
      ]),
    ).toBe("Ran node debug.mjs");
  });
});

describe("the status of a running turn", () => {
  it("moves through words while the model thinks, and counts its reasoning", async () => {
    const { liveStatus } = await import("./steps");
    expect(liveStatus("Thinking", 0, 0)).toBe("Thinking…");
    expect(liveStatus("Thinking", 0, 4500)).not.toBe("Thinking…");
    expect(liveStatus("Thinking", 2400, 0)).toBe("Thinking… ↓ 2.4k tokens");
    expect(liveStatus("", undefined, 0)).toBe("Thinking…");
    expect(liveStatus("Writing", 0, 0)).toBe("Writing…");
    expect(
      liveStatus("Running cd /vercel/devstation/state/workspaces/ws-1 && npm install", 0, 0),
    ).toBe("Running npm install…");
  });
});

describe("the stages of a build", () => {
  const started = (tool: string, input: Record<string, unknown>, i: number) => ({
    kind: "step.started",
    tool,
    message: tool,
    at: String(i),
    detail: { input },
  });
  it("marks the furthest stage reached, with every one before it done", async () => {
    const { buildPhases } = await import("./steps");
    const events = [
      started("write_file", { path: "index.html" }, 1),
      started("run_shell", { command: "npm install" }, 2),
    ];
    expect(buildPhases(events, { running: true }).map((p) => p.state)).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
    ]);
    // A screenshot after a plain HTML page: installing and building were
    // never needed, and count as done.
    const shot = [started("write_file", { path: "index.html" }, 1), started("screenshot", {}, 2)];
    expect(buildPhases(shot, { running: true }).map((p) => p.state)).toEqual([
      "done",
      "done",
      "done",
      "done",
      "active",
    ]);
    expect(buildPhases([], { running: true })[0].state).toBe("active");
    expect(buildPhases([], { building: true })[3].state).toBe("active");
  });
});

describe("work folded into one line", () => {
  it("counts every kind between two things said, the way the Claude app does", async () => {
    const { workLabel } = await import("./steps");
    const step = (tool: string, input: Record<string, unknown> = {}, i = 0) => ({
      id: `${tool}-${i}`,
      tool,
      title: tool,
      status: "done" as const,
      at: "",
      input,
    });
    const shells = [0, 1, 2].map((i) => step("run_shell", { command: `ls ${i}` }, i));
    const reads = [0, 1].map((i) => step("read_file", { path: `src/f${i}.ts` }, i));
    expect(
      workLabel([
        { kind: "shell", steps: shells.slice(0, 2) },
        { kind: "read", steps: reads },
        { kind: "shell", steps: shells.slice(2) },
      ]),
    ).toBe("Ran 3 commands, read 2 files");
    expect(
      workLabel([{ kind: "shell", steps: [step("run_shell", { command: "npm test" })] }]),
    ).toBe("Ran npm test");
    // A script reads as noise: it is "a command".
    expect(
      workLabel([
        {
          kind: "shell",
          steps: [step("run_shell", { command: 'T="$NETLIFY_AUTH_TOKEN" echo "=== list sites"' })],
        },
      ]),
    ).toBe("Ran a command");
  });
});
