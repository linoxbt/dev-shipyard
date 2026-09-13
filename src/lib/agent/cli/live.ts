import type { AgentEvent } from "../orchestrator";

// What a turn looks like in a real terminal.
//
// Laid out the way Codex lays it out, because it reads well at a glance: every
// piece of the turn is a cell that starts with a bullet. The model's words are
// a cell. Reading and searching fold into one "Explored" cell that lists what
// was looked at. Each command is its own "Ran" cell showing the command and
// the head and tail of what it printed. Edits say which file. A live status
// line at the bottom says what is happening now, for how long, and how to
// interrupt it, so a long silence never looks like a hang.
//
// The view owns a small live region at the bottom of the screen -- the open
// "Exploring" cell and the status line -- and redraws it in place. Finished
// cells are written above it and never move. Only used when stdout is a
// terminal; a pipe keeps the plain one-line-per-event log, which is what a
// pipe wants.

const ESC = String.fromCharCode(27);
const CLEAR_LINE = `${ESC}[2K`;
const UP = `${ESC}[1A`;
const FRAMES = ["◦", "•"];

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

type Input = Record<string, unknown>;

const text = (value: unknown): string =>
  typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);

export function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const EXPLORATION = new Set(["read_file", "list_files", "search_files", "recall"]);

export function isExploration(tool: string | undefined): boolean {
  return EXPLORATION.has(tool ?? "");
}

export interface Explored {
  verb: string;
  target: string;
}

export function exploration(tool: string | undefined, input: Input): Explored {
  switch (tool) {
    case "read_file":
      return { verb: "Read", target: text(input.path) };
    case "list_files":
      return { verb: "List", target: text(input.path) || "." };
    case "search_files": {
      const where = text(input.path);
      return { verb: "Search", target: `${text(input.query)}${where ? ` in ${where}` : ""}` };
    }
    default:
      return { verb: "Recall", target: text(input.query) };
  }
}

/** The lines under "Explored". Consecutive reads share one line, the way
 *  "Read trial_runner.py, worker.compose.yaml" does. */
export function exploredLines(items: Explored[]): string[] {
  const merged: { verb: string; targets: string[] }[] = [];
  for (const item of items) {
    const last = merged[merged.length - 1];
    if (last && last.verb === "Read" && item.verb === "Read") last.targets.push(item.target);
    else merged.push({ verb: item.verb, targets: [item.target] });
  }
  return merged.map((m) => `${m.verb} ${m.targets.join(", ")}`);
}

/** What a command printed, shortened to its head and tail. */
export function outputPreview(output: string, head = 4, tail = 1): string[] {
  const lines = output.replace(/\s+$/, "").split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  if (lines.length <= head + tail + 1) return lines;
  return [...lines.slice(0, head), `… +${lines.length - head - tail} lines`, ...lines.slice(-tail)];
}

/** A shell result as the model sees it starts with "exit N". A clean exit
 *  says nothing worth a line; a failing one does. */
function shellBody(output: string): string {
  const lines = output.split("\n");
  if (lines[0] === "exit 0") lines.shift();
  return lines.join("\n");
}

export interface Cell {
  title: string;
  /** Lines under the title, already carrying their connector. */
  body: string[];
  failed: boolean;
}

function bodyFrom(preview: string[], connector = "└"): string[] {
  return preview.map((line, i) => `${i === 0 ? connector : " "} ${line}`);
}

/** The cell for a finished step that is not exploration. */
export function stepCell(event: AgentEvent): Cell {
  const input = ((event.detail?.input ?? {}) as Input) || {};
  const output = text(event.detail?.output);
  const failed = event.kind === "step.failed";
  const why = failed ? bodyFrom(outputPreview(output || event.message, 4, 1)) : [];
  const path = text(input.path);

  switch (event.tool) {
    case "run_shell": {
      const lines = text(input.command).split("\n");
      const body: string[] = [];
      const extra = lines.slice(1);
      for (const line of extra.slice(0, 2)) body.push(`│ ${line}`);
      if (extra.length > 2) body.push(`│ … +${extra.length - 2} lines`);
      const shown = outputPreview(shellBody(output));
      body.push(...(shown.length ? bodyFrom(shown) : ["└ (no output)"]));
      return { title: `Ran ${lines[0]}`, body, failed };
    }
    case "run_tests":
    case "run_build":
    case "lint_and_typecheck": {
      const [command, ...rest] = output.split("\n");
      const hasCommand = command && !command.startsWith("This project");
      const shown = outputPreview(shellBody(hasCommand ? rest.join("\n") : output), 3, 2);
      const title = hasCommand
        ? `Ran ${command}`
        : event.tool === "lint_and_typecheck"
          ? "Checked lint and types"
          : "Ran the tests";
      return { title, body: shown.length ? bodyFrom(shown) : [], failed };
    }
    case "install_dependency":
      return {
        title: `${failed ? "Could not install" : "Installed"} ${text(input.name)}`,
        body: why,
        failed,
      };
    case "git": {
      const args = Array.isArray(input.args) ? ` ${(input.args as unknown[]).join(" ")}` : "";
      return {
        title: `Ran git ${text(input.op) || "status"}${args}`,
        body: bodyFrom(outputPreview(output, 3, 1)),
        failed,
      };
    }
    case "write_file": {
      const lines = typeof input.lines === "number" ? ` (${input.lines} lines)` : "";
      return {
        title: failed ? `Could not write ${path}` : `Wrote ${path}${lines}`,
        body: why,
        failed,
      };
    }
    case "edit_file":
      return { title: failed ? `Could not edit ${path}` : `Edited ${path}`, body: why, failed };
    case "delete_file":
      return { title: failed ? `Could not delete ${path}` : `Deleted ${path}`, body: why, failed };
    case "web_search":
      return { title: `Searched the web for ${text(input.query)}`, body: why, failed };
    case "fetch_url":
      return { title: `Read ${text(input.url)}`, body: why, failed };
    case "remember":
      return { title: `Noted: ${clip(text(input.note), 90)}`, body: why, failed };
    default: {
      const tool = event.tool ?? "a tool";
      return { title: tool.includes("__") ? `Called ${tool}` : `Used ${tool}`, body: why, failed };
    }
  }
}

function activityFor(tool: string | undefined, input: Input): string {
  switch (tool) {
    case "run_shell":
      return `Running ${clip(text(input.command).split("\n")[0], 60)}`;
    case "run_tests":
    case "run_build":
      return "Running the tests";
    case "lint_and_typecheck":
      return "Checking lint and types";
    case "install_dependency":
      return `Installing ${text(input.name)}`;
    case "git":
      return `Running git ${text(input.op)}`;
    case "write_file":
    case "edit_file":
    case "delete_file":
      return `Editing ${text(input.path)}`;
    case "web_search":
      return "Searching the web";
    case "fetch_url":
      return `Reading ${clip(text(input.url), 60)}`;
    default:
      return isExploration(tool) ? "Exploring" : "Working";
  }
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
  private explored: Explored[] = [];
  private midText = false;
  /** Newlines held back from the end of a chunk, so a message that ends in
   *  one does not leave an indented empty line behind. */
  private heldBreaks = 0;
  private suspended = false;
  private stopped = false;
  private activity = "Working";

  constructor(
    private readonly write: (text: string) => void,
    private readonly opts: LiveOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.started = this.now();
    const tick = opts.tickMs ?? 400;
    if (tick > 0) {
      this.timer = setInterval(() => this.redraw(), tick);
      // Never the reason a finished process stays alive.
      (this.timer as { unref?: () => void }).unref?.();
    }
    this.redraw();
  }

  private paint(value: string, code: string): string {
    return this.opts.colour ? `${ESC}[${code}m${value}${ESC}[0m` : value;
  }

  private bullet(failed = false): string {
    return failed ? this.paint("•", "31") : this.paint("•", "90");
  }

  private eraseLive() {
    if (this.liveLines === 0) return;
    let out = `\r${CLEAR_LINE}`;
    for (let i = 1; i < this.liveLines; i++) out += `${UP}${CLEAR_LINE}`;
    this.write(out);
    this.liveLines = 0;
  }

  private exploredCell(title: string): string[] {
    const lines = exploredLines(this.explored);
    return [
      `${this.bullet()} ${this.paint(title, "1")}`,
      ...lines.map((line, i) => `  ${this.paint(i === 0 ? "└" : " ", "90")} ${line}`),
    ];
  }

  private liveContent(): string[] {
    const lines = this.explored.length > 0 ? this.exploredCell("Exploring") : [];
    const symbol = this.paint(FRAMES[this.frame % FRAMES.length], "38;5;208");
    const meta = `(${formatElapsed(this.now() - this.started)} · ↓ ${formatTokens(this.outputTokens)} tokens · Ctrl-C to interrupt)`;
    lines.push(`${symbol} ${this.activity} ${this.paint(meta, "90")}`);
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

  /** Write finished lines above the live region. */
  private commit(lines: string[]) {
    this.eraseLive();
    this.write(`${lines.join("\n")}\n`);
  }

  private flushExplored() {
    if (this.explored.length === 0) return;
    const cell = this.exploredCell("Explored");
    this.explored = [];
    this.commit(cell);
  }

  private endText() {
    if (!this.midText) return;
    this.write("\n");
    this.midText = false;
    this.heldBreaks = 0;
  }

  private renderCell(cell: Cell): string[] {
    const [verb, ...rest] = cell.title.split(" ");
    const title = `${this.paint(verb, cell.failed ? "31;1" : "1")}${rest.length ? ` ${rest.join(" ")}` : ""}`;
    return [
      `${this.bullet(cell.failed)} ${title}`,
      ...cell.body.map((line) => {
        const connector = line.slice(0, 1);
        const content = line.slice(2);
        const coloured = cell.failed ? this.paint(content, "31") : this.paint(content, "90");
        return `  ${this.paint(connector, "90")} ${coloured}`;
      }),
    ];
  }

  delta(chunk: string) {
    if (this.stopped || !chunk) return;
    if (!this.midText) {
      this.eraseLive();
      this.flushExplored();
      this.eraseLive();
      this.write(`${this.bullet()} `);
      this.midText = true;
      this.heldBreaks = 0;
    }
    const trailing = chunk.length - chunk.replace(/\n+$/, "").length;
    const body = chunk.slice(0, chunk.length - trailing);
    if (body) {
      this.write("\n  ".repeat(this.heldBreaks) + body.replace(/\n/g, "\n  "));
      this.heldBreaks = 0;
    }
    this.heldBreaks += trailing;
  }

  event(event: AgentEvent) {
    if (this.stopped) return;
    const input = (event.detail?.input ?? {}) as Input;
    switch (event.kind) {
      case "usage": {
        const n = Number.parseInt(event.message, 10);
        if (Number.isFinite(n)) this.outputTokens = n;
        return;
      }
      case "step.started":
        this.endText();
        if (!isExploration(event.tool)) this.flushExplored();
        this.activity = activityFor(event.tool, input);
        this.redraw();
        return;
      case "step.completed":
      case "step.failed":
        this.endText();
        if (isExploration(event.tool) && event.kind === "step.completed") {
          this.explored.push(exploration(event.tool, input));
        } else {
          this.flushExplored();
          this.commit(this.renderCell(stepCell(event)));
        }
        this.activity = "Working";
        this.redraw();
        return;
      case "plan":
      case "turn.partial":
      case "handoff":
      case "task.aborted": {
        this.endText();
        this.flushExplored();
        const aborted = event.kind === "task.aborted";
        this.commit([
          `${this.bullet(aborted)} ${this.paint(event.message, aborted ? "31" : "90")}`,
        ]);
        this.redraw();
        return;
      }
      default:
        // checkpoint, approval.*, verification, task.completed and the rest are
        // bookkeeping, recorded in the session log, not screen furniture.
        return;
    }
  }

  /** Clear the live region and hold it, for a permission prompt. */
  suspend() {
    this.endText();
    this.flushExplored();
    this.eraseLive();
    this.suspended = true;
  }

  resume() {
    this.suspended = false;
    this.redraw();
  }

  stop() {
    this.endText();
    this.flushExplored();
    this.eraseLive();
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }
}
