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
}

export type ToolKind = "read" | "write" | "shell" | "search" | "git" | "web" | "plan" | "other";

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
};

export function toolKind(tool: string | null | undefined): ToolKind {
  return (tool && KIND[tool]) || "other";
}

/** Events that are bookkeeping, not something a person needs to see. */
const SILENT = new Set([
  "usage",
  "approval.requested",
  "approval.granted",
  "turn.partial",
  "task.completed",
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
    });
  });
  return steps;
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
  failed?: boolean;
}

export function compactSteps(steps: readonly Step[], max = 60): SavedStep[] {
  return steps
    .filter((s) => s.status !== "note")
    .slice(-max)
    .map((s) => ({
      ...(s.tool ? { tool: s.tool } : {}),
      title: s.title.slice(0, 160),
      ...(s.status === "failed" ? { failed: true } : {}),
    }));
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
