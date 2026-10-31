// Turning the agent's event stream into what the Coding Agent shows: a list of
// steps (one per tool call, with its command and output), the agent's current
// plan, and a one-line summary of a finished turn.
//
// The runner sends events exactly as the orchestrator emits them: a
// `step.started` and then a `step.completed` or `step.failed` for every tool
// call, plus notes (approvals, checkpoints, handoffs). Pure functions, so the
// transcript and the activity view agree and both are tested here.

export interface AgentEvent {
  kind: string;
  message: string;
  tool?: string;
  at: string;
  ok?: boolean;
  detail?: { input?: Record<string, unknown>; output?: string } & Record<string, unknown>;
}

export type StepStatus = "running" | "done" | "failed" | "note";

export interface Step {
  id: string;
  tool: string | null;
  title: string;
  status: StepStatus;
  /** What the step was asked to do (command, path, query). */
  input?: Record<string, unknown>;
  /** What it printed, for the tools whose output is worth showing. */
  output?: string;
  at: string;
  /** Tone of a note: warnings and handoffs stand out. */
  tone?: "warning" | "info" | "success";
  /** Position of the event that started it, to place it among the agent's
   *  narration (timelineFromEvents). */
  seq?: number;
  /** For a note, the event it came from ("checkpoint", "handoff", …). */
  event?: string;
  /** A screenshot the step took: its name while the turn runs, a JPEG data
   *  URL once the turn is saved. */
  shot?: string;
}

export type ToolKind =
  | "read"
  | "write"
  | "shell"
  | "search"
  | "git"
  | "web"
  | "plan"
  | "wallet"
  | "chain"
  | "browser"
  | "other";

const KIND: Record<string, ToolKind> = {
  read_file: "read",
  list_files: "read",
  shell_output: "read",
  write_file: "write",
  edit_file: "write",
  delete_file: "write",
  run_shell: "shell",
  run_tests: "shell",
  run_build: "shell",
  lint_and_typecheck: "shell",
  install_dependency: "shell",
  stop_shell: "shell",
  search_files: "search",
  recall: "search",
  git: "git",
  open_pull_request: "git",
  push_to_github: "git",
  web_search: "web",
  fetch_url: "web",
  update_plan: "plan",
  remember: "plan",
  create_wallet: "wallet",
  onchain: "chain",
  screenshot: "browser",
};

export function toolKind(tool: string | null | undefined): ToolKind {
  return (tool && KIND[tool]) || "other";
}

/** The agent saying what it is about to do, between batches of steps. */
export const NARRATION = "narration";

/** Events that are bookkeeping, not something a person needs to see. */
const SILENT = new Set([
  "usage",
  // Shown as the choices above the message box, not as a step.
  "question",
  "approval.requested",
  "approval.granted",
  "turn.partial",
  "task.completed",
  // The agent's own words between steps: shown by timelineFromEvents.
  NARRATION,
]);

const NOTE_TONE: Record<string, Step["tone"]> = {
  "approval.denied": "warning",
  "task.aborted": "warning",
  handoff: "warning",
  checkpoint: "info",
  verification: "info",
  plan: "info",
};

/**
 * One entry per tool call, in order. A call that has started and not finished
 * is "running"; the plan tool is left out (it is shown as the checklist).
 */
export function stepsFromEvents(events: readonly AgentEvent[]): Step[] {
  const steps: Step[] = [];
  // Open calls per tool, oldest first: the orchestrator runs calls one at a
  // time, but a parallel batch would still pair up in order.
  const open = new Map<string, Step[]>();
  events.forEach((e, i) => {
    if (SILENT.has(e.kind)) return;
    if (e.tool === "update_plan") return;
    const id = `${i}-${e.at}`;
    if (e.kind === "step.started") {
      const step: Step = {
        id,
        tool: e.tool ?? null,
        title: e.message,
        status: "running",
        input: e.detail?.input,
        at: e.at,
        seq: i,
      };
      steps.push(step);
      const key = e.tool ?? "";
      open.set(key, [...(open.get(key) ?? []), step]);
      return;
    }
    if (e.kind === "step.completed" || e.kind === "step.failed") {
      const key = e.tool ?? "";
      const queue = open.get(key) ?? [];
      const step = queue.shift();
      const failed = e.kind === "step.failed";
      if (step) {
        step.status = failed ? "failed" : "done";
        step.output = typeof e.detail?.output === "string" ? e.detail.output : undefined;
        if (failed) step.title = `${step.title}: ${e.message}`;
        else if (e.message && !step.input) step.title = e.message;
        if (typeof e.detail?.shot === "string") step.shot = e.detail.shot;
      } else {
        // A failure refused before it started (a gate), or a stream that was
        // trimmed: still worth a line.
        steps.push({
          id,
          tool: e.tool ?? null,
          title: e.message,
          status: failed ? "failed" : "done",
          input: e.detail?.input,
          output: typeof e.detail?.output === "string" ? e.detail.output : undefined,
          at: e.at,
          seq: i,
        });
      }
      return;
    }
    steps.push({
      id,
      tool: e.tool ?? null,
      title: e.message,
      status: "note",
      at: e.at,
      tone: NOTE_TONE[e.kind] ?? "info",
      seq: i,
      event: e.kind,
    });
  });
  return steps;
}

// --- timeline -----------------------------------------------------------------
//
// How a turn reads in the conversation, the way Base44 lays out its agent: the
// agent's own sentence about what it is doing next, then that batch of work as
// one collapsible line ("Read 4 files", "Edited App.tsx and 2 more"), then the
// next sentence. Consecutive steps of one kind make one group.

export type TimelineItem =
  | { type: "say"; id: string; text: string }
  | { type: "group"; id: string; kind: ToolKind | "note"; steps: Step[] };

/** Group the steps by kind, between the agent's narration, in event order. */
export function timelineFromEvents(events: readonly AgentEvent[]): TimelineItem[] {
  const said: { seq: number; item: TimelineItem }[] = [];
  events.forEach((e, i) => {
    const text = e.kind === NARRATION ? e.message.trim() : "";
    if (text) said.push({ seq: i, item: { type: "say", id: `say-${i}`, text } });
  });
  // Checkpoints are bookkeeping for undo: listed in Activity, not the chat.
  const steps = stepsFromEvents(events).filter((s) => s.event !== "checkpoint");
  return groupTimeline([
    ...said,
    ...steps.map((s, n) => ({ seq: s.seq ?? n, item: { type: "step" as const, step: s } })),
  ]);
}

type Entry = TimelineItem | { type: "step"; step: Step };

function groupTimeline(entries: { seq: number; item: Entry }[]): TimelineItem[] {
  const out: TimelineItem[] = [];
  for (const { item } of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (item.type !== "step") {
      out.push(item);
      continue;
    }
    const kind = item.step.status === "note" ? "note" : toolKind(item.step.tool);
    const last = out[out.length - 1];
    // Notes stand alone: a warning folded into "Ran 3 commands" is a warning
    // nobody reads.
    if (last?.type === "group" && last.kind === kind && kind !== "note") {
      last.steps.push(item.step);
    } else {
      out.push({ type: "group", id: `g-${item.step.id}`, kind, steps: [item.step] });
    }
  }
  return out;
}

/** A saved turn's timeline: its narration and titles, as kept in storage. */
export function timelineFromSaved(saved: readonly SavedStep[]): TimelineItem[] {
  return groupTimeline(
    saved.map((s, i) =>
      s.tool === NARRATION
        ? { seq: i, item: { type: "say" as const, id: `say-${i}`, text: s.title } }
        : {
            seq: i,
            item: {
              type: "step" as const,
              step: {
                id: String(i),
                tool: s.tool ?? null,
                title: s.title,
                status: s.failed ? ("failed" as const) : ("done" as const),
                at: "",
                ...(s.target ? { input: { path: s.target } } : {}),
                ...(s.shot ? { shot: s.shot } : {}),
              },
            },
          },
    ),
  );
}

const base = (path: string) => path.split("/").filter(Boolean).pop() ?? path;

function names(list: string[]): string {
  const unique = [...new Set(list)];
  if (unique.length <= 2) return unique.join(" and ");
  return `${unique.slice(0, 2).join(", ")} and ${unique.length - 2} more`;
}

/** The one line a group is folded into. */
export function groupLabel(kind: ToolKind | "note", steps: readonly Step[]): string {
  const n = steps.length;
  const paths = steps.map((s) => stepTarget(s)).filter((t): t is string => !!t);
  switch (kind) {
    case "note":
      return steps[0]?.title ?? "";
    case "read":
      return n === 1 && paths[0] ? `Read ${base(paths[0])}` : `Read ${n} files`;
    case "write":
      return paths.length ? `Edited ${names(paths.map(base))}` : `Edited ${n} files`;
    case "shell": {
      if (n === 1) {
        const tool = steps[0].tool;
        if (tool === "run_tests" || tool === "run_build") return "Ran the tests";
        if (tool === "lint_and_typecheck") return "Checked lint and types";
        if (tool === "install_dependency" && paths[0]) return `Installed ${paths[0]}`;
        if (paths[0]) return `Ran ${paths[0].length > 60 ? `${paths[0].slice(0, 57)}…` : paths[0]}`;
        return "Ran a command";
      }
      return `Ran ${n} commands`;
    }
    case "search":
      return n === 1 ? "Searched the project" : `Searched the project ${n} times`;
    case "web": {
      const queries = steps.filter((s) => s.tool === "web_search");
      const pages = n - queries.length;
      if (n === 1 && queries.length === 1 && paths[0]) return `Searched the web for “${paths[0]}”`;
      if (n === 1 && paths[0]) {
        try {
          return `Read ${new URL(paths[0]).hostname}`;
        } catch {
          return "Read a web page";
        }
      }
      const parts = [
        queries.length ? `${queries.length} search${queries.length === 1 ? "" : "es"}` : "",
        pages ? `${pages} page${pages === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      return `Researched on the web (${parts.join(", ")})`;
    }
    case "git":
      return n === 1 ? steps[0].title : `${n} git steps`;
    case "browser":
      return n === 1 ? "Took a screenshot" : `Took ${n} screenshots`;
    case "wallet":
      return "Set up a deployer wallet";
    case "chain":
      if (n === 1) {
        return paths[0]
          ? `On chain: ${paths[0].length > 56 ? `${paths[0].slice(0, 53)}…` : paths[0]}`
          : "Ran an on-chain command";
      }
      return `Ran ${n} on-chain commands`;
    case "plan":
      return "Made a note";
    default:
      return n === 1 ? steps[0].title : `${n} steps`;
  }
}

/** A decision the agent handed to the person: a question with a few choices. */
export interface AgentQuestion {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

/** The question a turn ended on, if it ended on one. */
export function pendingQuestion(events: readonly AgentEvent[]): AgentQuestion | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.kind === "usage" || e.kind === "task.completed" || e.kind === "checkpoint") continue;
    if (e.kind !== "question") return null;
    const d = e.detail ?? {};
    const options = Array.isArray(d.options)
      ? (d.options as unknown[])
          .filter(
            (o): o is { label: string; description?: unknown } =>
              !!o && typeof (o as { label?: unknown }).label === "string",
          )
          .slice(0, 4)
          .map((o) => ({
            label: o.label.slice(0, 80),
            ...(typeof o.description === "string"
              ? { description: o.description.slice(0, 300) }
              : {}),
          }))
      : [];
    if (options.length < 2) return null;
    return {
      question: (typeof d.question === "string" ? d.question : e.message).slice(0, 600),
      ...(typeof d.header === "string" && d.header ? { header: d.header.slice(0, 40) } : {}),
      options,
      ...(d.multiSelect === true ? { multiSelect: true } : {}),
    };
  }
  return null;
}

export interface PlanItem {
  step: string;
  status: "pending" | "in_progress" | "completed";
}

/** The most recent checklist the agent set with update_plan, if any. */
export function latestPlan(events: readonly AgentEvent[]): PlanItem[] | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.tool !== "update_plan") continue;
    const plan = e.detail?.input?.plan;
    if (!Array.isArray(plan)) continue;
    const items = plan
      .filter(
        (p): p is PlanItem =>
          !!p &&
          typeof (p as PlanItem).step === "string" &&
          ["pending", "in_progress", "completed"].includes((p as PlanItem).status),
      )
      .slice(0, 30);
    if (items.length) return items;
  }
  return null;
}

/** "Edited 3 files, ran 2 commands" for a finished turn's collapsed steps. */
export function stepSummary(steps: readonly Pick<Step, "tool" | "status">[]): string {
  const count = { read: 0, write: 0, shell: 0, search: 0, git: 0, web: 0 };
  let failed = 0;
  for (const s of steps) {
    if (s.status === "note") continue;
    if (s.status === "failed") failed++;
    const k = toolKind(s.tool);
    if (k in count) count[k as keyof typeof count]++;
  }
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n && parts.push(n === 1 ? one : many);
  add(count.write, "edited 1 file", `edited ${count.write} files`);
  add(count.shell, "ran 1 command", `ran ${count.shell} commands`);
  add(count.read, "read 1 file", `read ${count.read} files`);
  add(count.search, "searched once", `searched ${count.search} times`);
  add(count.git, "1 git step", `${count.git} git steps`);
  add(count.web, "1 web lookup", `${count.web} web lookups`);
  if (!parts.length) return failed ? `${failed} step${failed === 1 ? "" : "s"} failed` : "";
  const text = parts.join(", ");
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return failed ? `${sentence} · ${failed} failed` : sentence;
}

/** What a finished turn keeps in browser storage: titles only, no output. */
export interface SavedStep {
  tool?: string;
  title: string;
  /** The path, command or query it worked on, for the folded line's label. */
  target?: string;
  failed?: boolean;
  /** A screenshot, as the step's name until the page swaps in its picture. */
  shot?: string;
}

/** What a finished turn keeps: its narration and step titles, in order. */
export function compactTimeline(events: readonly AgentEvent[], max = 70): SavedStep[] {
  const out: SavedStep[] = [];
  for (const item of timelineFromEvents(events)) {
    if (item.type === "say") out.push({ tool: NARRATION, title: item.text.slice(0, 1200) });
    else out.push(...compactSteps(item.steps, Number.MAX_SAFE_INTEGER));
  }
  return out.slice(-max);
}

export function compactSteps(steps: readonly Step[], max = 60): SavedStep[] {
  return steps
    .filter((s) => s.status !== "note")
    .slice(-max)
    .map((s) => {
      const target = stepTarget(s);
      return {
        ...(s.tool ? { tool: s.tool } : {}),
        title: s.title.slice(0, 160),
        ...(target ? { target: target.slice(0, 300) } : {}),
        ...(s.status === "failed" ? { failed: true } : {}),
        ...(s.shot ? { shot: s.shot } : {}),
      };
    });
}

/** The shell command, path or query a step ran on, for its one-line label. */
export function stepTarget(step: Pick<Step, "tool" | "input">): string | null {
  const input = step.input ?? {};
  const pick = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  return pick("command") ?? pick("path") ?? pick("query") ?? pick("url") ?? pick("name");
}

// --- file tree ---------------------------------------------------------------

export interface TreeNode {
  name: string;
  path: string;
  children?: TreeNode[];
}

/** Folders first, then files, each alphabetical. */
export function buildFileTree(paths: readonly string[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const full of paths) {
    const parts = full.split("/").filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const path = parts.slice(0, i + 1).join("/");
      const leaf = i === parts.length - 1;
      node.children ??= [];
      let next = node.children.find((c) => c.name === part && !!c.children === !leaf);
      if (!next) {
        next = leaf ? { name: part, path } : { name: part, path, children: [] };
        node.children.push(next);
      }
      node = next;
    });
  }
  const sort = (nodes: TreeNode[]): TreeNode[] =>
    nodes
      .map((n) => (n.children ? { ...n, children: sort(n.children) } : n))
      .sort((a, b) =>
        !!a.children === !!b.children ? a.name.localeCompare(b.name) : a.children ? -1 : 1,
      );
  return sort(root.children ?? []);
}

/** The folders on the way to `path`, so opening a file reveals it. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
}

/** "3m ago" for timestamps in milliseconds. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Background commands still running: started with run_shell and not stopped. */
export function backgroundTasks(events: readonly AgentEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.kind !== "step.completed") continue;
    if (e.tool === "run_shell" && e.detail?.input?.background === true) n++;
    if (e.tool === "stop_shell") n = Math.max(0, n - 1);
  }
  return n;
}

/** "45s", "3m 12s", "1h 04m": how long the agent has been working. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
