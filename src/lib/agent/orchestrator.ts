import { readdirSync } from "node:fs";
import { costOfUsage, ratesFor } from "./pricing";
import { discardSnapshot, takeSnapshot } from "./snapshots";
import { checkpoint, isRepo } from "./git";
import {
  cwdFor,
  detectManifests,
  installCommand,
  lintCommand,
  lockfilesFor,
  manifestForChanges,
  testCommand,
} from "./project";
import {
  preflight,
  presentResult,
  requiresPerson,
  TOOLS,
  toolCatalogue,
  type ToolDefinition,
} from "./tools";
import { Workspace } from "./workspace";
import { hostExecutor, type ExecOptions, type Executor } from "./executor";
import type { ShellResult } from "./shell";
import { executeFileTool } from "./workspace-exec";
import {
  addUsage,
  EMPTY_USAGE,
  type ModelProvider,
  type ProviderMessage,
  type ProviderToolCall,
  type ProviderUsage,
} from "./providers";
import { agentDiff, agentStatus, git as gitOp, type GitOp } from "./git";
import { cloneDirName, cloneUrlProblem } from "./git-ops";
import { CODING_AGENT_SYSTEM, GIT_ADDENDUM } from "./system-prompt";
import { renderContext, retrieve } from "./memory/retrieve";
import { webSearch, fetchPage } from "./web";
import type { McpHub } from "./mcp";
import { asUntrusted } from "./secrets";
import { readMemory, remember, renderMemory } from "./memory/project-memory";
import type { MemoryStore } from "./memory/store";
import type { EmbeddingProvider } from "./memory/embeddings";

// The loop: propose, gate, execute, observe, repeat.
//
// The budgets are enforced here rather than asked of the model, because a model
// that is looping is in no position to notice it is looping. Steps, wall clock
// and cost are all checked before a turn, and hitting one ends the run with a
// reason rather than silently.
//
// Approval here is synchronous: the host asks a person and waits. The web host
// cannot do that, because an HTTP request will not stay open for a human, which is
// what the durable grant machinery in authorization.ts exists for. Both end up
// at the same policy decision; they differ only in how long they can wait for
// the answer.

export type AgentEventKind =
  | "plan"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "approval.requested"
  | "approval.granted"
  | "approval.denied"
  | "verification"
  | "checkpoint"
  | "turn.partial"
  | "handoff"
  | "usage"
  | "task.completed"
  | "task.aborted";

export interface AgentEvent {
  kind: AgentEventKind;
  message: string;
  tool?: string;
  ok?: boolean;
  detail?: Record<string, unknown>;
  at: string;
}

export interface ApprovalRequest {
  tool: string;
  /** The call's arguments, trimmed for display: the command a shell step
   *  would run is what a person needs to see before saying yes. */
  input?: Record<string, unknown>;
  operation: string;
  resources: string[];
  riskLevel: string;
  why: string;
}

/** Operations plan mode lets through: nothing on this list changes a file, a
 *  repository, a package set or anything outside the machine. */
const READ_ONLY_OPERATIONS = new Set(["file.read", "project.inspect", "web.fetch", "code.analyze"]);

/** Whether a call only looks. Decided by the same operation reading the policy
 *  uses, so `ls` passes and `rm` does not. MCP tools and anything unreadable
 *  count as changes: plan mode fails closed. */
export function readsOnly(call: { name: string; input: Record<string, unknown> }): boolean {
  const definition = TOOLS[call.name];
  if (!definition) return false;
  try {
    const operation = definition.operationFrom
      ? definition.operationFrom(call.input as never, {
          taskId: "plan",
          userId: "",
          projectId: "plan",
          populated: () => true,
        })
      : definition.operation;
    return READ_ONLY_OPERATIONS.has(operation);
  } catch {
    return false;
  }
}

export interface OrchestratorOptions {
  provider: ModelProvider;
  workspace: Workspace;
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
  maxSteps?: number;
  maxMs?: number;
  /** Stop before a turn that would take the run past this, in US dollars. */
  maxCostUsd?: number;
  onEvent?: (event: AgentEvent) => void;
  onDelta?: (chunk: string) => void;
  /** Called after every message rather than at the end of the run, so a host
   *  that persists this can resume a task that crashed half way through. */
  onProgress?: (snapshot: RunSnapshot) => void;
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
  signal?: AbortSignal;
  taskId?: string;
  userId?: string;
  projectId?: string;
  /** Person-performed tools this host can actually carry out, so the agent may
   *  propose them.
   *
   *  Normally these are hidden: offering a tool nobody can execute is worse
   *  than not offering it. A host that has a person at the other end is
   *  different. Calling one records a proposal and executes nothing, so there
   *  is no gate here: the decision is made afterwards, by the person, looking
   *  at what actually changed rather than at what the agent intends. */
  offerPersonTools?: string[];
  /** Appended to the system prompt, for a host with something extra to say
   *  about this particular run. */
  systemAddendum?: string;
  /** Plan mode: tools that read, search and look things up run; anything that
   *  would change the workspace or the world is refused before it is asked
   *  about. The host says so in the system prompt too. */
  readOnly?: boolean;
  /** The project index, when the host has built one. Absent means the agent
   *  works the way it did before: by listing and reading files. */
  memory?: MemoryStore | null;
  embeddings?: EmbeddingProvider | null;
  /** The ceiling on retrieved context, in tokens. */
  retrievalTokens?: number;
  /** MCP servers, already started. Their tools are offered alongside the
   *  built-in ones and called the same way. */
  mcp?: McpHub | null;
  /** Where commands run. Defaults to this machine.
   *
   *  The orchestrator never builds one: the host does, so the loop cannot
   *  quietly choose the weaker of the two. Whoever constructs it, disposes. */
  executor?: Executor;
}

export interface Handoff {
  tool: string;
  args: Record<string, unknown>;
  at: string;
}

export interface RunSnapshot {
  steps: number;
  filesChanged: string[];
  usage: ProviderUsage;
  costUsd: number;
  summary: string;
  messages: ProviderMessage[];
}

export interface RunResult {
  ok: boolean;
  summary: string;
  steps: number;
  filesChanged: string[];
  usage: ProviderUsage;
  costUsd: number;
  messages: ProviderMessage[];
  stoppedBecause: string;
  /** What the agent asked a person to do. Nothing here has happened. */
  handoffs: Handoff[];
}

/**
 * What a run has cost so far.
 *
 * Rates come from pricing.ts, per model, and include cache WRITES -- which
 * were collected and then priced at zero, so every budget was understated by
 * whatever prompt caching cost. The model argument is optional so existing
 * callers keep working; without one it prices at the dearest known rate, which
 * is the safe direction for a limit.
 */
export function costOf(usage: ProviderUsage, model = ""): number {
  const rates = ratesFor(model);
  return costOfUsage(usage, rates);
}

/** Tools the agent may use. The outward ones are left out here: the CLI has no
 *  browser session to carry them out, and offering a tool that cannot run is
 *  worse than not offering it. */
function availableTools(offered: string[] = []) {
  return toolCatalogue()
    .filter((t) => !requiresPerson(t.name) || offered.includes(t.name))
    .map((t) => {
      const def = TOOLS[t.name] as ToolDefinition;
      return {
        name: def.name,
        description: def.description,
        // The registry's Zod schemas are the source of truth; this is the
        // JSON-Schema shape the model is shown.
        inputSchema: zodToJsonSchema(def),
      };
    });
}

/** A minimal, honest JSON Schema from the tool's documented usage string.
 *  Deliberately not a general Zod-to-JSON-Schema converter: the registry's
 *  `usage` already names every argument, and a converter is a dependency and a
 *  source of drift for something this small. */
function zodToJsonSchema(def: ToolDefinition): Record<string, unknown> {
  const match = /\{(.*)\}/s.exec(def.usage);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const raw of (match?.[1] ?? "").split(",")) {
    const name = raw.trim().replace(/^"|"$/g, "").replace(/"$/, "");
    if (!name) continue;
    const optional = name.endsWith("?");
    const key = optional ? name.slice(0, -1).replace(/"$/, "") : name;
    const clean = key.replace(/"/g, "").trim();
    if (!clean) continue;
    properties[clean] = { type: clean === "args" ? "array" : "string" };
    if (!optional) required.push(clean);
  }
  return { type: "object", properties, required };
}

export class Orchestrator {
  private readonly opts: Required<Pick<OrchestratorOptions, "autonomy" | "maxSteps" | "maxMs">> &
    OrchestratorOptions;
  private usage: ProviderUsage = { ...EMPTY_USAGE };
  private readonly changed = new Set<string>();
  private readonly handoffs: Handoff[] = [];
  /** Built once, only when no executor was supplied. */
  private fallback: Executor | null = null;

  constructor(options: OrchestratorOptions) {
    this.opts = {
      autonomy: options.autonomy ?? "ask_sensitive",
      maxSteps: options.maxSteps ?? 40,
      maxMs: options.maxMs ?? 20 * 60_000,
      ...options,
    };
  }

  /**
   * Every command the agent runs goes through here.
   *
   * One method rather than four call sites, and the `runShell` import is gone
   * from this file on purpose: a fifth place to spawn a process cannot appear
   * without someone re-adding an import that a test forbids. The same reasoning
   * workspace.ts uses for its own boundary, one level up.
   */
  private shell(command: string, opts: Omit<ExecOptions, "signal">): Promise<ShellResult> {
    const executor = this.opts.executor ?? (this.fallback ??= hostExecutor());
    return executor.run(command, { ...opts, signal: this.opts.signal });
  }

  /**
   * Bring a repository into the workspace.
   *
   * Three things make this different from the other git ops, and all three are
   * the reason it is a tool rather than a line in `run_shell`.
   *
   * It goes through the executor rather than `git.ts`, which spawns on the
   * host. Every other op works on a repository that is already here; a clone
   * takes an address from the model and asks git to connect to it. In a
   * sandboxed run that belongs inside the container with the rest of the
   * agent's commands, not beside them on the host.
   *
   * It asks for a network, the way install_dependency does, because the sealed
   * shell has none.
   *
   * And it accepts no `args`. Everything in `args` is passed to git, and
   * `--upload-pack=<command>` is a documented way to make git run something.
   * The URL is validated against an allow-list of transports before it gets
   * anywhere near a shell.
   */
  private async clone(url: string, targetDir: unknown): Promise<{ ok: boolean; output: string }> {
    const problem = cloneUrlProblem(url);
    if (problem) return { ok: false, output: problem };

    const requested = typeof targetDir === "string" ? targetDir.trim() : "";
    const target = requested || cloneDirName(url);
    const resolved = this.opts.workspace.resolve(target);
    if (!resolved.ok) return { ok: false, output: resolved.reason };

    const result = await this.shell(`git clone -- ${quoteArg(url)} ${quoteArg(target)}`, {
      cwd: this.opts.workspace.root,
      timeoutMs: 300_000,
      network: true,
    });
    if (!result.ok) return { ok: false, output: formatShell(result) };
    return {
      ok: true,
      output: `Cloned into ${target}/\n${formatShell(result)}`,
    };
  }

  /** Spend so far, priced for the model actually answering. */
  private cost(): number {
    return costOf(this.usage, this.opts.provider.model);
  }

  private emit(kind: AgentEventKind, message: string, extra: Partial<AgentEvent> = {}) {
    this.opts.onEvent?.({ kind, message, at: new Date().toISOString(), ...extra });
  }

  private progress(steps: number, summary: string, messages: ProviderMessage[]) {
    this.opts.onProgress?.({
      steps,
      filesChanged: [...this.changed],
      usage: this.usage,
      costUsd: Number(this.cost().toFixed(4)),
      summary,
      messages,
    });
  }

  async run(goal: string, prior: ProviderMessage[] = []): Promise<RunResult> {
    const started = Date.now();

    // No automatic project search in front of the message. It turned "Hello"
    // into "Found 22 relevant place(s)" and answered a greeting with a tour of
    // the files, which is not what an assistant does. The agent searches when a
    // request needs it, through recall, search_files or web_search.
    const messages: ProviderMessage[] = [...prior, { role: "user", content: goal }];

    const system =
      CODING_AGENT_SYSTEM +
      (isRepo(this.opts.workspace.root) ? GIT_ADDENDUM : "") +
      renderMemory(readMemory(this.opts.workspace.root)) +
      (this.opts.systemAddendum ?? "");
    const tools = [
      ...availableTools(this.opts.offerPersonTools),
      // Namespaced by server, so two servers offering "query" cannot shadow
      // each other, and so a built-in can never be shadowed either.
      ...(this.opts.mcp?.tools ?? []).map((tool) => ({
        name: tool.name,
        description: `[${tool.server}] ${tool.description}`,
        inputSchema: tool.inputSchema,
      })),
    ];

    let steps = 0;
    let summary = "";
    let stoppedBecause = "finished";

    const usesGit = isRepo(this.opts.workspace.root);
    // Set once a snapshot is refused, so a workspace too large to copy is
    // walked once per run and said once, not re-walked and re-announced on
    // every turn.
    let snapshotSkip: string | null = null;

    for (;;) {
      const budget = this.budgetCheck(steps, started);
      if (budget) {
        stoppedBecause = budget;
        this.emit("task.aborted", budget);
        break;
      }

      const changedBeforeTurn = this.changed.size;

      const result = await this.opts.provider.generate({
        system,
        messages,
        tools,
        signal: this.opts.signal,
        onDelta: this.opts.onDelta,
      });

      this.usage = addUsage(this.usage, result.usage);
      this.emit("usage", `${this.usage.outputTokens} output tokens so far`, {
        detail: { costUsd: Number(this.cost().toFixed(4)) },
      });

      if (result.stopReason === "refusal") {
        stoppedBecause = "the model declined this request";
        this.emit("task.aborted", stoppedBecause);
        break;
      }

      if (result.text) summary = result.text;

      // No tool calls means it is answering rather than working.
      if (result.toolCalls.length === 0) {
        messages.push({ role: "assistant", content: result.text });
        this.progress(steps, summary, messages);
        break;
      }

      messages.push({ role: "assistant", content: result.text, toolCalls: result.toolCalls });
      this.progress(steps, summary, messages);

      // What this turn is about to change, captured before it changes it.
      //
      // The git path can checkpoint afterwards because history accumulates:
      // `reset --hard HEAD~1` lands on the commit before. A snapshot has no
      // "before" unless one was taken, so taking it afterwards would restore
      // exactly the state the user asked to undo.
      //
      // Taken here rather than at the top of the turn because the last turn of
      // a run is usually the model writing its summary with no tools at all.
      // Capturing there produced a post-change snapshot, newer than the good
      // one, and undo restored the change it was asked to remove.
      let pending: ReturnType<typeof takeSnapshot> = null;
      // Only before a turn that can change something: reading and searching
      // need no undo, and a greeting should not be told there is none.
      if (!usesGit && snapshotSkip === null && !result.toolCalls.every((call) => readsOnly(call))) {
        pending = takeSnapshot(this.opts.workspace.root, goal.slice(0, 80), {
          // Silently: a folder too big to copy aside simply has no undo for
          // this run. It is not something to interrupt the conversation with.
          onSkip: (reason) => {
            snapshotSkip = reason;
          },
        });
      }

      // A turn can ask for several tools at once, and the model treats them as
      // one unit of work. They are not: the third can fail after the first two
      // have already written to disk. Nothing rolls back, and nothing should,
      // because a partial edit is often the right thing to keep and build on.
      // What must not happen is the run carrying on as though the turn either
      // fully happened or fully did not, so a half-applied turn is said out
      // loud, in the transcript and to the model.
      const turn: TurnOutcome = { applied: [], failed: [] };
      for (const call of result.toolCalls) {
        steps++;
        const outcome = await this.runOne(call);
        // A plan update changes nothing in the project, so it is neither half
        // of a change nor evidence that one happened.
        if (call.name !== "update_plan") (outcome.ok ? turn.applied : turn.failed).push(call.name);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: outcome.output,
          isError: !outcome.ok,
        });
        this.progress(steps, summary, messages);
      }

      const partial = partialTurn(
        turn,
        result.toolCalls.filter((call) => call.name !== "update_plan").length,
      );
      if (partial) {
        this.emit("turn.partial", partial, { detail: { ...turn } });
        // Told to the model as well, because otherwise its next move is built
        // on the assumption that the turn either worked or did not.
        messages.push({ role: "user", content: partial });
      }

      // Checkpoint after a turn that actually changed something, so undo has
      // somewhere to go back to.
      //
      // Two paths, never none. Git is the better mechanism and stays the
      // default where it exists; a workspace without it gets a copy-aside
      // snapshot instead. Undo used to be a capability that silently depended
      // on somebody else's choice of version control: an empty folder is a
      // first-class place to work, so it gets a safety net too.
      const changedThisTurn = this.changed.size > changedBeforeTurn;
      if (usesGit) {
        if (this.changed.size > 0) {
          const point = await checkpoint(this.opts.workspace.root, goal.slice(0, 80));
          if (point.sha) this.emit("checkpoint", point.message, { detail: { sha: point.sha } });
        }
      } else if (pending) {
        // A turn that changed nothing needs no way back, and keeping a copy of
        // the workspace for every question the agent answers would fill a disk
        // with identical snapshots.
        if (changedThisTurn) {
          this.emit("checkpoint", `Checkpoint: ${pending.message}`, {
            detail: { snapshot: pending.id },
          });
        } else {
          discardSnapshot(this.opts.workspace.root, pending.id);
        }
      }
    }

    this.emit("task.completed", summary || "Done.", {
      detail: { steps, filesChanged: [...this.changed] },
    });

    return {
      ok: stoppedBecause === "finished",
      summary: summary || "Done.",
      steps,
      filesChanged: [...this.changed],
      usage: this.usage,
      costUsd: Number(this.cost().toFixed(4)),
      messages,
      stoppedBecause,
      handoffs: [...this.handoffs],
    };
  }

  /** The excerpts worth having in front of the agent before it starts.
   *
   *  Prepended to the goal rather than added to the system prompt: the system
   *  prompt is cached across turns and is the wrong place for something that
   *  changes with every goal. */

  /** Checked before each turn, never asked of the model: something that is
   *  looping cannot be relied on to notice. */
  private budgetCheck(steps: number, started: number): string | null {
    if (steps >= this.opts.maxSteps) return `Stopped after ${steps} steps, the limit for one run.`;
    if (Date.now() - started >= this.opts.maxMs) return "Stopped: this run hit its time limit.";
    const cost = this.cost();
    if (this.opts.maxCostUsd && cost >= this.opts.maxCostUsd) {
      return `Stopped: this run reached its $${this.opts.maxCostUsd} budget (about $${cost.toFixed(2)} spent).`;
    }
    return null;
  }

  private async runOne(call: ProviderToolCall): Promise<{ ok: boolean; output: string }> {
    if (this.opts.readOnly && !readsOnly(call)) {
      this.emit("plan", `Plan mode: did not run ${call.name}`, { tool: call.name });
      return {
        ok: false,
        output:
          `Plan mode is on, so ${call.name} was not run: only reading, searching and looking things up are allowed. ` +
          "Finish investigating and present the plan. The user switches plan mode off to carry it out.",
      };
    }

    // An MCP tool belongs to somebody else's server and has no entry in the
    // registry, so the policy engine has nothing to classify it by. They are
    // gated as a class rather than individually: the person configured the
    // server, and what its tools do is between them and it.
    if (this.opts.mcp?.has(call.name)) return this.runMcp(call);

    // A proposal, not an action. Recorded and handed back; the person decides
    // later, with the finished change in front of them.
    if (this.opts.offerPersonTools?.includes(call.name) && requiresPerson(call.name)) {
      this.handoffs.push({
        tool: call.name,
        args: call.input,
        at: new Date().toISOString(),
      });
      this.emit("handoff", `Proposed ${call.name}.`, { tool: call.name, detail: call.input });
      return {
        ok: true,
        output:
          `Recorded. ${call.name} has been put to the user, who will decide once you are finished. ` +
          "It has not happened yet, so do not describe it as done. Carry on with the work.",
      };
    }

    const gate = preflight(
      { id: call.id, name: call.name, args: call.input },
      {
        taskId: this.opts.taskId ?? "cli",
        userId: this.opts.userId ?? "",
        projectId: this.opts.projectId ?? "workspace",
        environment: "development",
        autonomy: this.opts.autonomy,
        // The registry cannot look at a filesystem: it is imported by the
        // browser. It asks, and this answers for the real workspace.
        populated: (path) => {
          const resolved = this.opts.workspace.resolve(path);
          if (!resolved.ok) return true;
          try {
            return readdirSync(resolved.absolute).length > 0;
          } catch {
            // Not there at all, so cloning into it creates it.
            return false;
          }
        },
      },
    );

    if (!gate.ok) {
      if (gate.rejection.reason !== "needs_authorization") {
        this.emit("step.failed", gate.rejection.message, { tool: call.name, ok: false });
        return { ok: false, output: gate.rejection.message };
      }

      const request: ApprovalRequest = {
        tool: call.name,
        operation: gate.rejection.action.operation,
        resources: gate.rejection.action.resources,
        riskLevel: gate.rejection.verdict.riskLevel,
        why: gate.rejection.message,
        input: eventInput(call),
      };
      this.emit("approval.requested", gate.rejection.message, {
        tool: call.name,
        detail: { ...request },
      });

      // No approver means nothing is auto-approved. Failing closed is the only
      // safe default: a host that forgot to wire this up must not silently get
      // full autonomy.
      const approved = this.opts.requestApproval ? await this.opts.requestApproval(request) : false;

      if (!approved) {
        this.emit("approval.denied", `${call.name} was not allowed.`, { tool: call.name });
        return {
          ok: false,
          output: `The user did not allow ${request.operation}. Work without it, or explain what you need.`,
        };
      }
      this.emit("approval.granted", `${call.name} allowed.`, { tool: call.name });
    }

    this.emit("step.started", describe(call), {
      tool: call.name,
      detail: { input: eventInput(call) },
    });
    const outcome = await this.execute(call);
    this.emit(outcome.ok ? "step.completed" : "step.failed", summarise(call, outcome), {
      tool: call.name,
      ok: outcome.ok,
      // What the terminal shows under a step: the command and what it printed.
      // Only for the tools whose output is worth showing, and bounded, because
      // events are also written to the session log.
      detail: {
        input: eventInput(call),
        ...(SHOWN_OUTPUT.has(call.name) || !outcome.ok
          ? { output: boundOutput(outcome.output) }
          : {}),
      },
    });

    const definition = TOOLS[call.name];
    return {
      ok: outcome.ok,
      output: definition ? presentResult(definition, outcome.output) : outcome.output,
    };
  }

  private async runMcp(call: ProviderToolCall): Promise<{ ok: boolean; output: string }> {
    this.emit("step.started", `Calling ${call.name}`, { tool: call.name });
    try {
      const output = await this.opts.mcp!.call(call.name, call.input);
      this.emit("step.completed", `${call.name} answered`, { tool: call.name, ok: true });
      // Wrapped as untrusted, like every other tool result carrying text from
      // outside: a server's output is data, not instructions.
      return { ok: true, output: asUntrusted(`MCP tool ${call.name}`, output) };
    } catch (error) {
      const why = error instanceof Error ? error.message : String(error);
      this.emit("step.failed", why, { tool: call.name, ok: false });
      return { ok: false, output: why };
    }
  }

  private async execute(call: ProviderToolCall): Promise<{ ok: boolean; output: string }> {
    const { workspace } = this.opts;
    const args = call.input;

    const fileResult = executeFileTool(workspace, call.name, args);
    if (fileResult) {
      if (fileResult.ok && (call.name === "write_file" || call.name === "edit_file")) {
        this.changed.add(String(args.path ?? ""));
      }
      return fileResult;
    }

    switch (call.name) {
      case "run_shell": {
        const seconds = Number(args.timeoutSeconds ?? 120);
        const result = await this.shell(String(args.command ?? ""), {
          cwd: workspace.root,
          timeoutMs: seconds * 1000,
        });
        return { ok: result.ok, output: formatShell(result) };
      }

      case "git": {
        const op = String(args.op ?? "status") as GitOp;
        const extra = (args.args as string[]) ?? [];
        if (op === "clone") return this.clone(String(args.url ?? ""), args.target_dir);
        // diff and status are answered against the last commit this run did
        // not make, because the run's own checkpoints would otherwise hide the
        // agent's work from it. See agentDiff in git.ts.
        if (op === "diff") return present(await agentDiff(workspace.root, extra));
        if (op === "status") return present(await agentStatus(workspace.root));
        return present(await gitOp(workspace.root, op, extra));
      }

      case "web_search": {
        const found = await webSearch(String(args.query ?? ""), { signal: this.opts.signal });
        if (!found.ok) return { ok: false, output: found.error };
        if (found.results.length === 0) {
          return { ok: true, output: `No web results for "${args.query}".` };
        }
        return {
          ok: true,
          output: found.results
            .map(
              (r, i) => `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet}` : ""}`,
            )
            .join("\n\n"),
        };
      }

      case "fetch_url": {
        const page = await fetchPage(String(args.url ?? ""), { signal: this.opts.signal });
        if (!page.ok) return { ok: false, output: page.text };
        // The fallback has to be on the text, not on the whole string: the
        // template always contains the URL, so a page with nothing in it was
        // coming back as a bare URL and reading as a successful fetch.
        const body = page.text.trim() || "(this page had no readable text in it)";
        return {
          ok: true,
          output: `${page.url}${page.truncated ? " (truncated)" : ""}\n\n${body}`,
        };
      }

      case "remember": {
        const result = remember(
          workspace.root,
          String(args.note ?? ""),
          args.tag ? String(args.tag) : null,
        );
        return { ok: result.ok, output: result.message };
      }

      case "update_plan": {
        const plan = Array.isArray(args.plan) ? (args.plan as Array<{ status?: string }>) : [];
        const done = plan.filter((step) => step.status === "completed").length;
        return { ok: true, output: `Plan updated: ${done} of ${plan.length} steps done.` };
      }

      case "recall": {
        const store = this.opts.memory;
        if (!store) {
          return {
            ok: false,
            output:
              "This project has not been indexed, so there is nothing to search. Use search_files and list_files instead.",
          };
        }
        const hits = await retrieve(store, String(args.query ?? ""), {
          embeddings: this.opts.embeddings,
          maxTokens: this.opts.retrievalTokens,
          signal: this.opts.signal,
        });
        if (hits.length === 0) {
          return { ok: true, output: "Nothing in this project matched that." };
        }
        return { ok: true, output: renderContext(hits) };
      }

      case "run_tests":
      case "run_build":
        return this.runProjectCommand("test");

      case "lint_and_typecheck":
        return this.runProjectCommand("lint");

      case "install_dependency": {
        const manifests = detectManifests(workspace.root);
        const manifest = manifestForChanges(manifests, [...this.changed]);
        if (!manifest)
          return { ok: false, output: "No package manifest was found in this project." };
        const command = installCommand(manifest.ecosystem, String(args.name ?? ""), {
          version: args.version ? String(args.version) : undefined,
          dev: Boolean(args.dev),
        });
        const result = await this.shell(command, {
          cwd: cwdFor(workspace.root, manifest),
          timeoutMs: 300_000,
          // Installing is the one thing that genuinely needs the network. A
          // sandboxed executor gives it one; the host one ignores this.
          network: true,
        });
        // The manifest and lockfile diff, not just "success": the model needs
        // to see what actually changed.
        const diff = isRepo(workspace.root)
          ? await gitOp(workspace.root, "diff", ["--", ...lockfilesFor(manifest)])
          : null;
        return {
          ok: result.ok,
          output: `${command}\n${formatShell(result)}${diff?.stdout ? `\n\n--- manifest changes ---\n${diff.stdout}` : ""}`,
        };
      }

      default:
        return { ok: false, output: `There is no tool called "${call.name}".` };
    }
  }

  private async runProjectCommand(kind: "test" | "lint"): Promise<{ ok: boolean; output: string }> {
    const { workspace } = this.opts;
    const manifests = detectManifests(workspace.root);
    // In a monorepo, run what the changed files belong to rather than
    // everything.
    const manifest = manifestForChanges(manifests, [...this.changed]);
    if (!manifest)
      return {
        ok: true,
        output: "This project has no package manifest, so there is nothing to run.",
      };

    const command = kind === "test" ? testCommand(manifest) : lintCommand(manifest);
    if (!command) {
      // A real answer, not a failure. "No tests" and "tests failed" are
      // different things.
      return { ok: true, output: `This project has no ${kind} command configured.` };
    }
    const result = await this.shell(command, {
      cwd: cwdFor(workspace.root, manifest),
      timeoutMs: 600_000,
    });
    return { ok: result.ok, output: `${command}\n${formatShell(result)}` };
  }
}

/** Shell-quote one argument. The URL is validated before it gets here; this is
 *  the second of the two, because one of them being enough is how the git tool
 *  ended up with an injection hole in the first place. */
function quoteArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Tools whose output the terminal shows under the step. A file's contents or
 *  a page's text is the model's material, not something to print. */
const SHOWN_OUTPUT = new Set(["run_shell", "run_tests", "run_build", "lint_and_typecheck", "git"]);

/** A call's arguments for display and the log: file bodies and patches are
 *  replaced by their size, so an event is never a second copy of a file. */
function eventInput(call: ProviderToolCall): Record<string, unknown> {
  const { content, patch, ...rest } = (call.input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  if (typeof content === "string") out.lines = content.split("\n").length;
  if (typeof patch === "string") out.patchLines = patch.split("\n").length;
  return out;
}

function boundOutput(output: string): string {
  if (output.length <= 8000) return output;
  return `${output.slice(0, 5000)}\n…\n${output.slice(-2500)}`;
}

function formatShell(result: {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}): string {
  const parts: string[] = [];
  if (result.timedOut) parts.push("(timed out and was killed)");
  parts.push(`exit ${result.code ?? "null"}`);
  if (result.stdout.trim()) parts.push(result.stdout.trimEnd());
  // stderr is never summarised away: the exact failure text is what the model
  // needs in order to fix it.
  if (result.stderr.trim()) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
  return parts.join("\n");
}

interface TurnOutcome {
  applied: string[];
  failed: string[];
}

/**
 * What to say when a turn asked for several things and only some happened.
 *
 * Null when there is nothing to report: one tool, or all of them worked, or
 * none did. The middle case is the one with no natural signal, and it is the
 * one where the workspace is in a state nobody asked for.
 */
export function partialTurn(turn: TurnOutcome, total: number): string | null {
  if (total < 2) return null;
  if (turn.failed.length === 0 || turn.applied.length === 0) return null;
  return (
    `Only part of that turn happened. ${turn.applied.length} of ${total} tool calls ` +
    `took effect (${turn.applied.join(", ")}), and ${turn.failed.length} did not ` +
    `(${turn.failed.join(", ")}). The workspace is in a half-applied state. ` +
    "Check what is actually there before continuing, rather than assuming either outcome."
  );
}

function present(result: { ok: boolean } & Parameters<typeof formatShell>[0]) {
  return { ok: result.ok, output: formatShell(result) };
}

function describe(call: ProviderToolCall): string {
  const a = call.input;
  switch (call.name) {
    case "read_file":
      return `Reading ${a.path}`;
    case "write_file":
      return `Writing ${a.path}`;
    case "edit_file":
      return `Patching ${a.path}`;
    case "search_files":
      return `Searching for "${a.query}"`;
    case "list_files":
      return "Listing the project";
    case "run_shell":
      return `Running ${String(a.command).slice(0, 70)}`;
    case "git":
      return `git ${a.op}`;
    case "run_tests":
    case "run_build":
      return "Running the tests";
    case "lint_and_typecheck":
      return "Linting and type-checking";
    case "install_dependency":
      return `Installing ${a.name}`;
    case "update_plan":
      return "Updating the plan";
    case "recall":
      return `Searching the project for "${a.query}"`;
    case "web_search":
      return `Searching the web for "${a.query}"`;
    case "fetch_url":
      return `Reading ${a.url}`;
    case "remember":
      return "Making a note about this project";
    default:
      return call.name;
  }
}

function summarise(call: ProviderToolCall, outcome: { ok: boolean; output: string }): string {
  if (!outcome.ok) return outcome.output.split("\n")[0].slice(0, 160);

  // Tools whose output is the material itself get counted rather than quoted.
  // Echoing the first line of a file as the step summary tells the reader
  // nothing and buries the line that does.
  const lines = outcome.output.split("\n");
  switch (call.name) {
    case "read_file":
      return `Read ${call.input.path} (${lines.length} lines)`;
    case "list_files":
    case "search_files":
      return `${lines.filter(Boolean).length} result(s)`;
    case "web_search":
      return `${(outcome.output.match(/^\d+\. /gm) ?? []).length} web result(s)`;
    default:
      break;
  }

  const firstLine = lines[0];
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine || describe(call);
}
