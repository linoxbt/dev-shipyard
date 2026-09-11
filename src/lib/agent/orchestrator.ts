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
import { runShell } from "./shell";
import { Workspace } from "./workspace";
import { executeFileTool } from "./workspace-exec";
import {
  addUsage,
  EMPTY_USAGE,
  type ModelProvider,
  type ProviderMessage,
  type ProviderToolCall,
  type ProviderUsage,
} from "./providers";
import { git as gitOp, type GitOp } from "./git";
import { CODING_AGENT_SYSTEM, GIT_ADDENDUM } from "./system-prompt";

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
  operation: string;
  resources: string[];
  riskLevel: string;
  why: string;
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
}

/** Per-million-token rates, so a budget can be expressed in money rather than
 *  tokens. Overridable because prices change and this should not need a code
 *  edit when they do. */
const INPUT_PER_MTOK = Number(process.env.AGENT_INPUT_COST ?? 2);
const OUTPUT_PER_MTOK = Number(process.env.AGENT_OUTPUT_COST ?? 10);
const CACHE_READ_PER_MTOK = Number(process.env.AGENT_CACHE_READ_COST ?? 0.2);

export function costOf(usage: ProviderUsage): number {
  return (
    (usage.inputTokens / 1e6) * INPUT_PER_MTOK +
    (usage.outputTokens / 1e6) * OUTPUT_PER_MTOK +
    (usage.cacheReadTokens / 1e6) * CACHE_READ_PER_MTOK
  );
}

/** Tools the agent may use. The outward ones are left out here: the CLI has no
 *  browser session to carry them out, and offering a tool that cannot run is
 *  worse than not offering it. */
function availableTools() {
  return toolCatalogue()
    .filter((t) => !requiresPerson(t.name))
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

  constructor(options: OrchestratorOptions) {
    this.opts = {
      autonomy: options.autonomy ?? "ask_sensitive",
      maxSteps: options.maxSteps ?? 40,
      maxMs: options.maxMs ?? 20 * 60_000,
      ...options,
    };
  }

  private emit(kind: AgentEventKind, message: string, extra: Partial<AgentEvent> = {}) {
    this.opts.onEvent?.({ kind, message, at: new Date().toISOString(), ...extra });
  }

  private progress(steps: number, summary: string, messages: ProviderMessage[]) {
    this.opts.onProgress?.({
      steps,
      filesChanged: [...this.changed],
      usage: this.usage,
      costUsd: Number(costOf(this.usage).toFixed(4)),
      summary,
      messages,
    });
  }

  async run(goal: string, prior: ProviderMessage[] = []): Promise<RunResult> {
    const started = Date.now();
    const messages: ProviderMessage[] = [...prior, { role: "user", content: goal }];
    const system = CODING_AGENT_SYSTEM + (isRepo(this.opts.workspace.root) ? GIT_ADDENDUM : "");
    const tools = availableTools();

    let steps = 0;
    let summary = "";
    let stoppedBecause = "finished";

    for (;;) {
      const budget = this.budgetCheck(steps, started);
      if (budget) {
        stoppedBecause = budget;
        this.emit("task.aborted", budget);
        break;
      }

      const result = await this.opts.provider.generate({
        system,
        messages,
        tools,
        signal: this.opts.signal,
        onDelta: this.opts.onDelta,
      });

      this.usage = addUsage(this.usage, result.usage);
      this.emit("usage", `${this.usage.outputTokens} output tokens so far`, {
        detail: { costUsd: Number(costOf(this.usage).toFixed(4)) },
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

      for (const call of result.toolCalls) {
        steps++;
        const outcome = await this.runOne(call);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: outcome.output,
          isError: !outcome.ok,
        });
        this.progress(steps, summary, messages);
      }

      // Checkpoint after a turn that actually changed something, so undo has
      // somewhere to go back to.
      if (this.changed.size > 0 && isRepo(this.opts.workspace.root)) {
        const point = await checkpoint(this.opts.workspace.root, goal.slice(0, 80));
        if (point.sha) this.emit("checkpoint", point.message, { detail: { sha: point.sha } });
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
      costUsd: Number(costOf(this.usage).toFixed(4)),
      messages,
      stoppedBecause,
    };
  }

  /** Checked before each turn, never asked of the model: something that is
   *  looping cannot be relied on to notice. */
  private budgetCheck(steps: number, started: number): string | null {
    if (steps >= this.opts.maxSteps) return `Stopped after ${steps} steps, the limit for one run.`;
    if (Date.now() - started >= this.opts.maxMs) return "Stopped: this run hit its time limit.";
    const cost = costOf(this.usage);
    if (this.opts.maxCostUsd && cost >= this.opts.maxCostUsd) {
      return `Stopped: this run reached its $${this.opts.maxCostUsd} budget (about $${cost.toFixed(2)} spent).`;
    }
    return null;
  }

  private async runOne(call: ProviderToolCall): Promise<{ ok: boolean; output: string }> {
    const gate = preflight(
      { id: call.id, name: call.name, args: call.input },
      {
        taskId: this.opts.taskId ?? "cli",
        userId: this.opts.userId ?? "",
        projectId: this.opts.projectId ?? "workspace",
        environment: "development",
        autonomy: this.opts.autonomy,
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

    this.emit("step.started", describe(call), { tool: call.name });
    const outcome = await this.execute(call);
    this.emit(outcome.ok ? "step.completed" : "step.failed", summarise(call, outcome), {
      tool: call.name,
      ok: outcome.ok,
    });

    const definition = TOOLS[call.name];
    return {
      ok: outcome.ok,
      output: definition ? presentResult(definition, outcome.output) : outcome.output,
    };
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
        const result = await runShell(String(args.command ?? ""), {
          cwd: workspace.root,
          timeoutMs: seconds * 1000,
          signal: this.opts.signal,
        });
        return { ok: result.ok, output: formatShell(result) };
      }

      case "git": {
        const result = await gitOp(
          workspace.root,
          String(args.op ?? "status") as GitOp,
          (args.args as string[]) ?? [],
        );
        return { ok: result.ok, output: formatShell(result) };
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
        const result = await runShell(command, {
          cwd: cwdFor(workspace.root, manifest),
          timeoutMs: 300_000,
        });
        // The manifest and lockfile diff, not just "success": the model needs
        // to see what actually changed.
        const diff = isRepo(workspace.root)
          ? await runShell(`git diff -- ${lockfilesFor(manifest).join(" ")}`, {
              cwd: workspace.root,
              timeoutMs: 30_000,
            })
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
    const result = await runShell(command, {
      cwd: cwdFor(workspace.root, manifest),
      timeoutMs: 600_000,
      signal: this.opts.signal,
    });
    return { ok: result.ok, output: `${command}\n${formatShell(result)}` };
  }
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
    default:
      break;
  }

  const firstLine = lines[0];
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine || describe(call);
}
