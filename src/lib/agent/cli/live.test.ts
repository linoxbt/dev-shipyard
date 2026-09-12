import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "../orchestrator";
import { LiveView, formatElapsed, formatTokens, groupFor, groupLabel } from "./live";

// The terminal view: words as they arrive, work collapsed per kind, and a
// status line that proves nothing is hung.

const ESC = String.fromCharCode(27);
const ERASE = new RegExp(`\\r${ESC}\\[2K(${ESC}\\[1A${ESC}\\[2K)*`, "g");

function view() {
  const chunks: string[] = [];
  let clock = 0;
  const live = new LiveView((t) => chunks.push(t), { colour: false, tickMs: 0, now: () => clock });
  // Erases removed, so assertions see the text rather than cursor traffic.
  const screen = () => chunks.join("").replace(ERASE, "");
  const ev = (kind: AgentEvent["kind"], tool?: string, message = ""): AgentEvent => ({
    kind,
    tool,
    message,
    at: new Date().toISOString(),
  });
  return { live, chunks, screen, ev, tick: (ms: number) => (clock += ms) };
}

describe("grouping work", () => {
  it("collapses consecutive commands into one line", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.started", "run_shell"));
    live.event(ev("step.completed", "run_shell"));
    live.event(ev("step.started", "run_shell"));
    live.event(ev("step.completed", "run_shell"));
    live.stop();
    expect(screen()).toContain("Ran 2 shell commands");
    expect(screen()).not.toContain("run_shell");
  });

  it("starts a new line when the kind of work changes", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.completed", "read_file"));
    live.event(ev("step.completed", "read_file"));
    live.event(ev("step.completed", "edit_file"));
    live.stop();
    expect(screen()).toContain("Read 2 files");
    expect(screen()).toContain("Edited 1 file");
  });

  it("never hides a failure inside a count", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.completed", "run_shell"));
    live.event(ev("step.failed", "run_shell", "exit 1: tests failed"));
    live.stop();
    expect(screen()).toContain("run_shell failed:");
    expect(screen()).toContain("tests failed");
  });
});

describe("the model's words", () => {
  it("prints text as it arrives, after the work line it follows", () => {
    const { live, screen, ev } = view();
    live.event(ev("step.completed", "read_file"));
    live.delta("Here is ");
    live.delta("what I found.");
    live.stop();
    const out = screen();
    expect(out.indexOf("Read 1 file")).toBeLessThan(out.indexOf("Here is what I found."));
  });

  it("does not print bookkeeping such as checkpoints", () => {
    const { live, screen, ev } = view();
    live.event(ev("checkpoint", undefined, "Checkpoint: hello"));
    live.event(ev("task.completed", undefined, "Done."));
    live.stop();
    expect(screen()).not.toContain("Checkpoint");
  });
});

describe("the status line", () => {
  it("shows elapsed time and tokens while waiting", () => {
    const { live, chunks, ev, tick } = view();
    tick(12_000);
    live.event(ev("usage", undefined, "1234 output tokens so far"));
    live.event(ev("step.started", "run_shell"));
    expect(chunks.join("")).toContain("(12s · ↓ 1.2k tokens)");
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

  it("formats time and tokens compactly", () => {
    expect(formatElapsed(9_000)).toBe("9s");
    expect(formatElapsed(125_000)).toBe("2m 05s");
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(38_300)).toBe("38.3k");
  });

  it("labels each kind of tool", () => {
    expect(groupLabel(groupFor("web_search"), 2)).toBe("Searched the web 2 times");
    expect(groupLabel(groupFor("fetch_url"), 1)).toBe("Fetched 1 page");
    expect(groupLabel(groupFor("install_dependency"), 3)).toBe("Ran 3 shell commands");
  });
});
