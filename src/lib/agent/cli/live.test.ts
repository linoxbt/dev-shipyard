import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "../orchestrator";
import {
  LiveView,
  exploredSummary,
  formatElapsed,
  formatTokens,
  outputPreview,
  stepCell,
} from "./live";

// The terminal view, laid out like Claude Code: every part of a turn is a
// cell with a dot, actions read `Tool(what)` with the result under a ⎿,
// exploration folds into one line, and a status line proves nothing is hung.

const ESC = String.fromCharCode(27);
const ERASE = new RegExp(`\\r${ESC}\\[2K(${ESC}\\[1A${ESC}\\[2K)*`, "g");

function view() {
  const chunks: string[] = [];
  let clock = 0;
  const live = new LiveView((t) => chunks.push(t), {
    colour: false,
    tickMs: 0,
    now: () => clock,
    verb: "Elucidating",
  });
  const screen = () => chunks.join("").replace(ERASE, "");
  const ev = (
    kind: AgentEvent["kind"],
    tool?: string,
    detail: Record<string, unknown> = {},
    message = "",
  ): AgentEvent => ({ kind, tool, message, detail, at: new Date().toISOString() });
  return { live, chunks, screen, ev, tick: (ms: number) => (clock += ms) };
}

describe("exploring", () => {
  it("folds reads and searches into one line", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.completed", "read_file", { input: { path: "trial_runner.py" } }));
    live.event(ev("step.completed", "read_file", { input: { path: "worker.compose.yaml" } }));
    live.event(ev("step.completed", "search_files", { input: { query: "AGENTS.md" } }));
    live.stop();
    expect(screen()).toContain("● Read 2 files, searched 1 pattern");
    // Finished as one line when the turn stops; the live region only redraws it.
    expect(screen().endsWith("● Read 2 files, searched 1 pattern\n")).toBe(true);
  });

  it("closes the exploring line when other work starts", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.completed", "list_files", { input: {} }));
    live.event(ev("step.started", "run_shell", { input: { command: "ls" } }));
    live.event(
      ev("step.completed", "run_shell", { input: { command: "ls" }, output: "exit 0\na\nb" }),
    );
    live.stop();
    const out = screen();
    expect(out.indexOf("● Listed 1 directory")).toBeLessThan(out.indexOf("● Bash(ls)"));
  });
});

describe("actions", () => {
  it("show a command as Bash(...) with what it printed under ⎿, shortened", () => {
    const { live, screen, ev } = view();
    const output = ["exit 0", ...Array.from({ length: 20 }, (_, i) => `line ${i + 1}`)].join("\n");
    live.event(ev("step.completed", "run_shell", { input: { command: "pytest -q" }, output }));
    live.stop();
    const out = screen();
    expect(out).toContain("● Bash(pytest -q)");
    expect(out).toContain("  ⎿  line 1");
    expect(out).toContain("     … +15 lines");
    expect(out).toContain("line 20");
    expect(out).not.toContain("exit 0");
  });

  it("say when a command printed nothing", () => {
    const cell = stepCell({
      kind: "step.completed",
      tool: "run_shell",
      message: "",
      at: "",
      detail: { input: { command: "mkdir -p out" }, output: "exit 0\n" },
    });
    expect(cell.title).toBe("Bash(mkdir -p out)");
    expect(cell.body).toEqual(["⎿  (No output)"]);
  });

  it("never hide a failure", () => {
    const { live, screen, ev } = view();
    live.event(
      ev("step.failed", "run_shell", {
        input: { command: "npm test" },
        output: "exit 1\n2 failing",
      }),
    );
    live.stop();
    const out = screen();
    expect(out).toContain("● Bash(npm test)");
    expect(out).toContain("exit 1");
    expect(out).toContain("2 failing");
  });

  it("name the file a write touched, and the query a search used", () => {
    const cell = (tool: string, input: Record<string, unknown>) =>
      stepCell({ kind: "step.completed", tool, message: "", at: "", detail: { input } });
    expect(cell("write_file", { path: "index.html", lines: 12 })).toMatchObject({
      title: "Write(index.html)",
      body: ["⎿  Wrote 12 lines to index.html"],
    });
    expect(cell("edit_file", { path: "src/a.ts" }).title).toBe("Update(src/a.ts)");
    expect(cell("web_search", { query: "nvidia toolkit" }).title).toBe(
      'Web Search("nvidia toolkit")',
    );
    expect(cell("install_dependency", { name: "viem" }).title).toBe("Bash(install viem)");
  });
});

describe("the todo list", () => {
  it("shows what is done, in progress and still to do", () => {
    const { live, screen, ev } = view();
    live.event(
      ev("step.completed", "update_plan", {
        input: {
          plan: [
            { step: "Inspect the repository", status: "completed" },
            { step: "Write the contract", status: "in_progress" },
            { step: "Add tests", status: "pending" },
          ],
        },
      }),
    );
    live.stop();
    const out = screen();
    expect(out).toContain("● Update Todos");
    expect(out).toContain("  ⎿  ☒ Inspect the repository");
    expect(out).toContain("◼ Write the contract");
    expect(out).toContain("☐ Add tests");
  });
});

describe("the model's words", () => {
  it("are a cell with a dot, with following lines indented", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.completed", "read_file", { input: { path: "a.ts" } }));
    live.delta("I'll resume the build.\nFirst, ");
    live.delta("the tests.\n");
    live.stop();
    const out = screen();
    expect(out.indexOf("● Read 1 file")).toBeLessThan(out.indexOf("● I'll resume the build."));
    expect(out).toContain("● I'll resume the build.\n  First, the tests.\n");
    expect(out).not.toContain("tests.\n  \n");
  });

  it("does not print bookkeeping such as checkpoints", () => {
    const { live, screen, ev } = view();
    live.event(ev("checkpoint", undefined, {}, "Checkpoint: hello"));
    live.event(ev("task.completed", undefined, {}, "Done."));
    live.stop();
    expect(screen()).not.toContain("Checkpoint");
  });
});

describe("the status line", () => {
  it("turns while the model thinks, with time, tokens and how to stop it", () => {
    const { live, chunks, ev, tick } = view();
    tick(12_000);
    live.event(ev("usage", undefined, {}, "1234 output tokens so far"));
    const thinking = chunks.join("");
    live.event(ev("step.started", "run_shell", { input: { command: "pytest -q" } }));
    const out = chunks.join("");
    expect(`${thinking}${out}`).toContain("Elucidating…");
    expect(out).toContain("Running pytest -q");
    expect(out).toContain("(12s · ↓ 1.2k tokens · ctrl+c to interrupt)");
    live.stop();
  });

  it("steps aside for a permission prompt and comes back", () => {
    const { live, chunks, ev } = view();
    live.event(ev("step.started", "run_shell"));
    live.suspend();
    const before = chunks.length;
    live.event(ev("step.started", "run_shell"));
    expect(chunks.length).toBe(before);
    live.resume();
    expect(chunks.length).toBeGreaterThan(before);
    live.stop();
  });

  it("formats time, tokens and previews compactly", () => {
    expect(formatElapsed(9_000)).toBe("9s");
    expect(formatElapsed(125_000)).toBe("2m 05s");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(38_300)).toBe("38.3k");
    expect(outputPreview("a\nb")).toEqual(["a", "b"]);
    expect(outputPreview("")).toEqual([]);
    expect(exploredSummary({ read: 1, listed: 2, searched: 0, recalled: 0 })).toBe(
      "Read 1 file, listed 2 directories",
    );
  });
});
