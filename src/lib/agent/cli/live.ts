import type { AgentEvent } from "../orchestrator";
import { fitWidth } from "./width";

// What a turn looks like in a real terminal.
//
// Laid out the way Claude Code lays it out. Every piece of a turn is a cell
// that starts with a dot: the model's words; one line summing up what it read
// and searched; and each action as `Tool(what)` with its result under a ⎿,
// the head and tail of a command's output, the file a write touched, the todo
// list as it changes. A status line at the bottom turns while the agent works
// and says for how long and how to interrupt it.
//
// The view owns a small live region at the bottom of the screen -- the open
// exploring line and the status line -- and redraws it in place. Finished
// cells are written above it and never move. Only used when stdout is a
// terminal; a pipe keeps the plain one-line-per-event log, which is what a
// pipe wants.

const ESC = String.fromCharCode(27);
const CLEAR_LINE = `${ESC}[2K`;
const UP = `${ESC}[1A`;
const FRAMES = ["✢", "✳", "✶", "✻", "✽", "✻", "✶", "✳"];
const VERBS = [
  "Thinking",
  "Working",
  "Pondering",
  "Crafting",
  "Elucidating",
  "Tinkering",
  "Brewing",
  "Figuring",
];

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

export interface ExploredCounts {
  read: number;
  listed: number;
  searched: number;
  recalled: number;
}

const EXPLORATION: Record<string, keyof ExploredCounts> = {
  read_file: "read",
  list_files: "listed",
  search_files: "searched",
  recall: "recalled",
};

export function isExploration(tool: string | undefined): boolean {
  return (tool ?? "") in EXPLORATION;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Read 2 files, listed 1 directory, searched 3 patterns". */
export function exploredSummary(counts: ExploredCounts): string {
  const parts: string[] = [];
  if (counts.read) parts.push(`read ${plural(counts.read, "file", "files")}`);
  if (counts.listed) parts.push(`listed ${plural(counts.listed, "directory", "directories")}`);
  if (counts.searched) parts.push(`searched ${plural(counts.searched, "pattern", "patterns")}`);
  if (counts.recalled) parts.push(`recalled ${plural(counts.recalled, "note", "notes")}`);
  const sentence = parts.join(", ");
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
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
  /** `Tool(what)`, or a plain heading for a cell that is not a tool call. */
  title: string;
  /** Lines under the title. The first carries the ⎿. */
  body: string[];
  failed: boolean;
  /** Body in the normal colour rather than dimmed, for a todo list. */
  plain?: boolean;
}

function under(lines: string[]): string[] {
  return lines.map((line, i) => `${i === 0 ? "⎿" : " "}  ${line}`);
}

/** The cell for a finished step that is not exploration. */
export function stepCell(event: AgentEvent): Cell {
  const input = ((event.detail?.input ?? {}) as Input) || {};
  const output = text(event.detail?.output);
  const failed = event.kind === "step.failed";
  const why = under(outputPreview(output || event.message, 4, 1));
  const path = text(input.path);
  const result = (lines: string[]) => (failed ? why : under(lines));

  switch (event.tool) {
    case "run_shell": {
      if (input.background === true) {
        return {
          title: `Bash(${clip(text(input.command).split("\n")[0], 90)})`,
          body: result(["Running in the background"]),
          failed,
        };
      }
      const shown = outputPreview(shellBody(output));
      return {
        title: `Bash(${clip(text(input.command).split("\n")[0], 90)})`,
        body: under(shown.length ? shown : ["(No output)"]),
        failed,
      };
    }
    case "run_tests":
    case "run_build":
    case "lint_and_typecheck": {
      const [command, ...rest] = output.split("\n");
      const hasCommand = Boolean(command) && !command.startsWith("This project");
      const shown = outputPreview(shellBody(hasCommand ? rest.join("\n") : output), 3, 2);
      const label = event.tool === "lint_and_typecheck" ? "lint and type-check" : "tests";
      return {
        title: `Bash(${hasCommand ? clip(command, 90) : `run ${label}`})`,
        body: under(shown.length ? shown : ["(No output)"]),
        failed,
      };
    }
    case "install_dependency":
      return {
        title: `Bash(install ${text(input.name)})`,
        body: result([`Installed ${text(input.name)}`]),
        failed,
      };
    case "git": {
      const args = Array.isArray(input.args) ? ` ${(input.args as unknown[]).join(" ")}` : "";
      const shown = outputPreview(output, 3, 1);
      return {
        title: `Bash(git ${text(input.op) || "status"}${args})`,
        body: under(shown.length ? shown : ["(No output)"]),
        failed,
      };
    }
    case "write_file": {
      const lines = typeof input.lines === "number" ? `${input.lines} lines` : "the file";
      return { title: `Write(${path})`, body: result([`Wrote ${lines} to ${path}`]), failed };
    }
    case "edit_file":
      return { title: `Update(${path})`, body: result([`Updated ${path}`]), failed };
    case "delete_file":
      return { title: `Delete(${path})`, body: result([`Deleted ${path}`]), failed };
    case "web_search":
      return {
        title: `Web Search("${clip(text(input.query), 80)}")`,
        body: result(["Did 1 search"]),
        failed,
      };
    case "fetch_url":
      return { title: `Fetch(${clip(text(input.url), 90)})`, body: result(["Received"]), failed };
    case "remember":
      return { title: "Remember", body: result([clip(text(input.note), 90)]), failed };
    case "shell_output": {
      const shown = outputPreview(output.split("\n").slice(1).join("\n"), 4, 2);
      return {
        title: `BashOutput(${text(input.id)})`,
        body: under([output.split("\n")[0] || "", ...shown].filter(Boolean)),
        failed,
      };
    }
    case "stop_shell":
      return { title: `KillShell(${text(input.id)})`, body: result(["Stopped"]), failed };
    case "update_plan": {
      const steps = Array.isArray(input.plan) ? (input.plan as Array<Record<string, unknown>>) : [];
      const mark = (status: unknown) =>
        status === "completed" ? "☒" : status === "in_progress" ? "◼" : "☐";
      const items = steps.map((s) => `${mark(s.status)} ${text(s.step)}`);
      const explanation = text(input.explanation);
      return {
        title: "Update Todos",
        body: under(explanation ? [explanation, ...items] : items),
        failed,
        plain: true,
      };
    }
    default: {
      const tool = event.tool ?? "Tool";
      return { title: tool, body: result(["Done"]), failed };
    }
  }
}

function activityFor(tool: string | undefined, input: Input): string | null {
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
    case "update_plan":
      return "Planning";
    default:
      return isExploration(tool) ? "Exploring" : null;
  }
}

export interface LiveOptions {
  colour: boolean;
  now?: () => number;
  /** Redraw interval. Zero disables the timer, for tests. */
  tickMs?: number;
  /** The word the status line uses while the model thinks. Random by default. */
  verb?: string;
  /** The terminal's width, read on every redraw. The live lines are cut to fit
   *  it: a line that wraps is only half erased, and the other half stays on
   *  screen, once per tick. */
  columns?: () => number;
}

export class LiveView {
  private readonly now: () => number;
  private readonly started: number;
  private readonly verb: string;
  private outputTokens = 0;
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Lines currently drawn in the live region, so they can be erased. */
  private liveLines = 0;
  private explored: ExploredCounts = { read: 0, listed: 0, searched: 0, recalled: 0 };
  private midText = false;
  /** Newlines held back from the end of a chunk, so a message that ends in
   *  one does not leave an indented empty line behind. */
  private heldBreaks = 0;
  private suspended = false;
  private stopped = false;
  private activity: string | null = null;

  constructor(
    private readonly write: (text: string) => void,
    private readonly opts: LiveOptions,
  ) {
    this.now = opts.now ?? Date.now;
    this.started = this.now();
    this.verb = opts.verb ?? VERBS[Math.floor(Math.random() * VERBS.length)];
    const tick = opts.tickMs ?? 150;
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

  private exploring(): boolean {
    const e = this.explored;
    return e.read + e.listed + e.searched + e.recalled > 0;
  }

  private eraseLive() {
    if (this.liveLines === 0) return;
    let out = `\r${CLEAR_LINE}`;
    for (let i = 1; i < this.liveLines; i++) out += `${UP}${CLEAR_LINE}`;
    this.write(out);
    this.liveLines = 0;
  }

  private exploredLine(done: boolean): string {
    const dot = done ? this.paint("●", "32") : this.paint("●", "90");
    return `${dot} ${this.paint(exploredSummary(this.explored), "1")}`;
  }

  private liveContent(): string[] {
    const lines = this.exploring() ? [this.exploredLine(false)] : [];
    const symbol = this.paint(FRAMES[this.frame % FRAMES.length], "38;5;208");
    const meta = `(${formatElapsed(this.now() - this.started)} · ↓ ${formatTokens(this.outputTokens)} tokens · ctrl+c to interrupt)`;
    const label = this.activity ?? `${this.verb}…`;
    lines.push(`${symbol} ${this.paint(label, "38;5;208")} ${this.paint(meta, "90")}`);
    const columns = this.opts.columns?.();
    if (!columns) return lines;
    // Three cells spare: the spinner glyphs are drawn two wide by some terminals.
    const width = Math.max(20, columns - 3);
    return lines.map((line) => fitWidth(line, width));
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
    if (!this.exploring()) return;
    const line = this.exploredLine(true);
    this.explored = { read: 0, listed: 0, searched: 0, recalled: 0 };
    this.commit([line]);
  }

  private endText() {
    if (!this.midText) return;
    this.write("\n");
    this.midText = false;
    this.heldBreaks = 0;
  }

  private renderCell(cell: Cell): string[] {
    // A finished cell never moves, so a wrap would not break the redraw, but a
    // command folded mid-word is harder to read than one cut with an ellipsis.
    const columns = this.opts.columns?.();
    const fit = (line: string) => (columns ? fitWidth(line, Math.max(20, columns - 2)) : line);
    const dot = this.paint("●", cell.failed ? "31" : "32");
    const open = cell.title.indexOf("(");
    const title =
      open > 0
        ? `${this.paint(cell.title.slice(0, open), "1")}${cell.title.slice(open)}`
        : this.paint(cell.title, "1");
    return [
      fit(`${dot} ${title}`),
      ...cell.body.map((line) => {
        const connector = line.slice(0, 1);
        const content = line.slice(3);
        const coloured = cell.failed
          ? this.paint(content, "31")
          : cell.plain
            ? content
            : this.paint(content, "90");
        return fit(`  ${this.paint(connector, "90")}  ${coloured}`);
      }),
    ];
  }

  delta(chunk: string) {
    if (this.stopped || !chunk) return;
    if (!this.midText) {
      this.eraseLive();
      this.flushExplored();
      this.eraseLive();
      this.write("● ");
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
          this.explored[EXPLORATION[event.tool as string]]++;
        } else {
          this.flushExplored();
          this.commit(this.renderCell(stepCell(event)));
        }
        this.activity = null;
        this.redraw();
        return;
      // turn.partial is for the model, which is told which calls did not take
      // effect. On screen it read as an alarm about a turn that had changed
      // nothing, and the model then had to explain it away.
      case "plan":
      case "handoff":
      case "task.aborted": {
        this.endText();
        this.flushExplored();
        const aborted = event.kind === "task.aborted";
        this.commit([
          `${this.paint("●", aborted ? "31" : "90")} ${this.paint(event.message, aborted ? "31" : "90")}`,
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
