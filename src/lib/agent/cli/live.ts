import type { AgentEvent } from "../orchestrator";

// What a turn looks like in a real terminal.
//
// The old view printed a line for every event -- "> list_files Listing the
// project", "+ list_files 13 result(s)" -- and nothing at all while the model
// was thinking. That is a log, not an interface. This is the shape people know
// from Claude Code and Codex: the model's words as they arrive, work collapsed
// into one line per kind ("Ran 2 shell commands"), and a live status line with
// elapsed time and tokens so a long silence never looks like a hang.
//
// It owns a small "live region" at the bottom of the screen -- the open group
// line and the status line -- and redraws it in place. Anything permanent is
// written above it. Only used when stdout is a terminal; a pipe keeps the plain
// one-line-per-event log, which is what a pipe wants.

const ESC = String.fromCharCode(27);
const CLEAR_LINE = `${ESC}[2K`;
const UP = `${ESC}[1A`;
const FRAMES = ["✶", "✸", "✹", "✺", "✹", "✷"];

const GROUPS: Record<string, { one: string; many: string }> = {
  shell: { one: "Ran 1 shell command", many: "Ran {n} shell commands" },
  read: { one: "Read 1 file", many: "Read {n} files" },
  edit: { one: "Edited 1 file", many: "Edited {n} files" },
  search: { one: "Searched 1 time", many: "Searched {n} times" },
  web: { one: "Searched the web", many: "Searched the web {n} times" },
  fetch: { one: "Fetched 1 page", many: "Fetched {n} pages" },
  other: { one: "Used 1 tool", many: "Used {n} tools" },
};

export function groupFor(tool: string | undefined): keyof typeof GROUPS {
  switch (tool) {
    case "run_shell":
    case "run_tests":
    case "run_build":
    case "lint_and_typecheck":
    case "install_dependency":
    case "git":
      return "shell";
    case "read_file":
      return "read";
    case "write_file":
    case "edit_file":
    case "delete_file":
      return "edit";
    case "list_files":
    case "search_files":
    case "recall":
      return "search";
    case "web_search":
      return "web";
    case "fetch_url":
      return "fetch";
    default:
      return "other";
  }
}

export function groupLabel(kind: string, count: number): string {
  const g = GROUPS[kind] ?? GROUPS.other;
  return count === 1 ? g.one : g.many.replace("{n}", String(count));
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export interface LiveOptions {
  colour: boolean;
  now?: () => number;
  /** Redraw interval. Zero disables the timer, for tests. */
  tickMs?: number;
}

export class LiveView {
  private readonly now: () => number;
  private readonly started: number;
  private outputTokens = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Lines currently drawn in the live region, so they can be erased. */
  private liveLines = 0;
  private group: { kind: string; count: number } | null = null;
  private midText = false;
  private suspended = false;
  private stopped = false;
  private activity = "Working";

  constructor(
    private readonly write: (text: string) => void,
    private readonly opts: LiveOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.started = this.now();
    const tick = opts.tickMs ?? 120;
    if (tick > 0) {
      this.timer = setInterval(() => this.redraw(), tick);
      // Never the reason a finished process stays alive.
      (this.timer as { unref?: () => void }).unref?.();
    }
    this.redraw();
  }

  private paint(text: string, code: string): string {
    return this.opts.colour ? `${ESC}[${code}m${text}${ESC}[0m` : text;
  }

  private eraseLive() {
    if (this.liveLines === 0) return;
    let out = `\r${CLEAR_LINE}`;
    for (let i = 1; i < this.liveLines; i++) out += `${UP}${CLEAR_LINE}`;
    this.write(out);
    this.liveLines = 0;
  }

  private liveContent(): string[] {
    const lines: string[] = [];
    if (this.group) {
      lines.push(`  ${this.paint("⎿", "90")} ${groupLabel(this.group.kind, this.group.count)}`);
    }
    const symbol = this.paint(FRAMES[this.frame % FRAMES.length], "38;5;208");
    const meta = `(${formatElapsed(this.now() - this.started)} · ↓ ${formatTokens(this.outputTokens)} tokens)`;
    lines.push(`${symbol} ${this.activity}… ${this.paint(meta, "90")}`);
    return lines;
  }

  /** Redraw the live region. Not while text is mid-sentence, where moving the
   *  cursor would tear the line, and not while a prompt is waiting. */
  private redraw() {
    if (this.stopped || this.suspended || this.midText) return;
    this.frame++;
    this.eraseLive();
    const lines = this.liveContent();
    this.write(lines.join("\n"));
    this.liveLines = lines.length;
  }

  /** Write something permanent above the live region. */
  private commit(text: string) {
    this.eraseLive();
    this.write(text.endsWith("\n") ? text : `${text}\n`);
  }

  private closeGroup() {
    if (!this.group) return;
    const line = `  ${this.paint("⎿", "90")} ${groupLabel(this.group.kind, this.group.count)}`;
    this.group = null;
    this.commit(line);
  }

  private endText() {
    if (!this.midText) return;
    this.write("\n");
    this.midText = false;
  }

  delta(chunk: string) {
    if (this.stopped) return;
    if (!this.midText) {
      this.eraseLive();
      this.closeGroup();
      this.eraseLive();
    }
    this.midText = true;
    this.write(chunk);
  }

  event(event: AgentEvent) {
    if (this.stopped) return;
    switch (event.kind) {
      case "usage": {
        const n = Number.parseInt(event.message, 10);
        if (Number.isFinite(n)) this.outputTokens = n;
        return;
      }
      case "step.started":
        this.endText();
        this.activity = describeActivity(event);
        this.redraw();
        return;
      case "step.completed": {
        this.endText();
        const kind = groupFor(event.tool);
        if (this.group && this.group.kind !== kind) this.closeGroup();
        this.group = this.group ? { kind, count: this.group.count + 1 } : { kind, count: 1 };
        this.activity = "Working";
        this.redraw();
        return;
      }
      case "step.failed":
        this.endText();
        this.closeGroup();
        // Failures are never folded into a count: an error hidden inside
        // "Ran 3 shell commands" is an error nobody sees.
        this.commit(
          `  ${this.paint("⎿", "31")} ${this.paint(`${event.tool ?? "step"} failed:`, "31")} ${event.message}`,
        );
        this.activity = "Working";
        this.redraw();
        return;
      case "plan":
      case "turn.partial":
      case "task.aborted":
        this.endText();
        this.closeGroup();
        this.commit(this.paint(`  ${event.message}`, event.kind === "task.aborted" ? "31" : "90"));
        this.redraw();
        return;
      default:
        // checkpoint, approval.*, verification, task.completed and the rest are
        // bookkeeping, recorded in the session log, not screen furniture.
        return;
    }
  }

  /** Clear the live region and hold it, for a permission prompt. */
  suspend() {
    this.endText();
    this.closeGroup();
    this.eraseLive();
    this.suspended = true;
  }

  resume() {
    this.suspended = false;
    this.redraw();
  }

  stop() {
    this.endText();
    this.closeGroup();
    this.eraseLive();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}

function describeActivity(event: AgentEvent): string {
  switch (groupFor(event.tool)) {
    case "shell":
      return "Running";
    case "read":
      return "Reading";
    case "edit":
      return "Editing";
    case "search":
      return "Searching";
    case "web":
      return "Searching the web";
    case "fetch":
      return "Fetching";
    default:
      return "Working";
  }
}
