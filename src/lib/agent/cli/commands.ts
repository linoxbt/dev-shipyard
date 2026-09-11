import { accessSync, constants, existsSync } from "node:fs";
import { checkpointBase, isRepo, listCheckpoints, undoCheckpoint } from "../git";
import { evaluate } from "../policy";
import { runShell } from "../shell";
import { requiresPerson, toolCatalogue, TOOLS, type ToolDefinition } from "../tools";
import { configuredProviderName } from "../providers";
import { embeddingsFromEnv } from "../memory/embeddings";
import { indexWorkspace, openStore } from "../memory/workspace-index";
import { formatEntry, memoryPath, readMemory } from "../memory/project-memory";
import {
  Orchestrator,
  type AgentEvent,
  type ApprovalRequest,
  type RunResult,
} from "../orchestrator";
import { SessionStore, type SessionRecord } from "../session-store";
import { Workspace } from "../workspace";
import type { ModelProvider, ProviderMessage } from "../providers";
import { renderApproval, renderEvent, renderSessions, renderUsage } from "./render";
import { CLI_NAME } from "./args";

// The commands take their terminal as a parameter rather than reaching for
// process.stdout, so every one of them can be driven by a test with no tty,
// no keyboard and no network.

export interface Terminal {
  out(text: string): void;
  err(text: string): void;
  ask(question: string): Promise<string>;
  colour: boolean;
}

export interface CommandContext {
  root: string;
  terminal: Terminal;
  provider: ModelProvider;
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
  maxSteps?: number;
  maxCostUsd?: number;
  yes?: boolean;
  signal?: AbortSignal;
}

/** Reads one answer and treats anything that is not a clear yes as a no.
 *  Silence, a stray newline and a closed pipe all mean no, which is the only
 *  safe reading of them. */
export function isYes(answer: string): boolean {
  return /^(y|yes)$/i.test(answer.trim());
}

function approver(context: CommandContext) {
  return async (request: ApprovalRequest): Promise<boolean> => {
    if (context.yes) {
      context.terminal.out(`Auto-approved ${request.operation} (--yes).`);
      return true;
    }
    context.terminal.out(renderApproval(request, context.terminal.colour));
    const answer = await context.terminal.ask("Allow this? [y/N] ");
    return isYes(answer);
  };
}

export interface RunOutcome {
  code: number;
  session: SessionRecord;
  /** The full result, when the run got far enough to produce one. Absent when
   *  the provider threw, which is the case `resume` exists for. */
  result?: RunResult;
}

export async function runCommand(
  context: CommandContext,
  goal: string,
  options: { resume?: SessionRecord; offerPersonTools?: string[]; systemAddendum?: string } = {},
): Promise<RunOutcome> {
  const { terminal } = context;
  const workspace = new Workspace(context.root);
  const store = new SessionStore(context.root);

  // Refreshed at the start of every run, incrementally. A first run in a large
  // repository pays for the walk; every one after it re-chunks only what
  // changed, which is usually nothing or one file.
  const embeddings = embeddingsFromEnv();
  const memory = openStore(context.root);
  try {
    await indexWorkspace(context.root, { store: memory, embeddings });
  } catch {
    // The agent works without an index. It reads and lists files instead.
  }

  const session =
    options.resume ??
    store.create(goal, { provider: context.provider.name, model: context.provider.model });
  if (options.resume) {
    session.goal = goal;
    session.status = "running";
    session.stoppedBecause = "";
    store.save(session);
  }

  terminal.out(`session ${session.id}  ${context.provider.name}/${context.provider.model}`);
  terminal.out(`goal: ${goal}`);
  terminal.out("");

  const prior: ProviderMessage[] = options.resume ? options.resume.messages : [];

  const orchestrator = new Orchestrator({
    provider: context.provider,
    workspace,
    autonomy: context.autonomy,
    maxSteps: context.maxSteps,
    maxCostUsd: context.maxCostUsd,
    signal: context.signal,
    taskId: session.id,
    projectId: context.root,
    requestApproval: approver(context),
    memory,
    embeddings,
    offerPersonTools: options.offerPersonTools,
    systemAddendum: options.systemAddendum,
    onEvent: (event: AgentEvent) => {
      // The log is written before the line is printed: what a watching
      // terminal sees should never lag behind what this one shows.
      store.appendEvent(session.id, event);
      const line = renderEvent(event, terminal.colour);
      if (line) terminal.out(line);
    },
    onProgress: (snapshot) => {
      session.steps = snapshot.steps;
      session.filesChanged = snapshot.filesChanged;
      session.usage = snapshot.usage;
      session.costUsd = snapshot.costUsd;
      session.summary = snapshot.summary;
      session.messages = snapshot.messages;
      store.save(session);
    },
  });

  try {
    const result = await orchestrator.run(goal, prior);
    session.status = result.ok ? "finished" : "stopped";
    session.steps = result.steps;
    session.filesChanged = result.filesChanged;
    session.usage = result.usage;
    session.costUsd = result.costUsd;
    session.summary = result.summary;
    session.stoppedBecause = result.stoppedBecause;
    session.messages = result.messages;
    store.save(session);

    terminal.out("");
    terminal.out(result.summary);
    terminal.out(renderUsage(result.costUsd, result.steps, result.filesChanged));
    if (!result.ok) terminal.err(result.stoppedBecause);
    return { code: result.ok ? 0 : 1, session, result };
  } catch (error) {
    // A crash still leaves a session on disk that `resume` can pick up; the
    // point of persisting after every message is that this case is survivable.
    session.status = "failed";
    session.stoppedBecause = error instanceof Error ? error.message : String(error);
    store.save(session);
    terminal.err(`Run failed: ${session.stoppedBecause}`);
    terminal.err(`Resume it with: ${CLI_NAME} resume ${session.id}`);
    return { code: 1, session };
  } finally {
    memory.close();
  }
}

export function sessionsCommand(context: CommandContext): number {
  const store = new SessionStore(context.root);
  context.terminal.out(renderSessions(store.list()));
  return 0;
}

/** Replays a session's event log, and optionally keeps following it. A run
 *  writes its log as it goes, so this works from a second terminal while the
 *  first is still working. */
export async function statusCommand(
  context: CommandContext,
  id: string | undefined,
  options: { follow?: boolean; pollMs?: number; until?: () => boolean } = {},
): Promise<number> {
  const store = new SessionStore(context.root);
  const session = id ? store.load(id) : store.latest();
  if (!session) {
    context.terminal.err(id ? `No session ${id} in this workspace.` : "No sessions yet.");
    return 1;
  }

  context.terminal.out(`session ${session.id}  ${session.status}`);
  context.terminal.out(`goal: ${session.goal}`);

  let offset = 0;
  const drain = () => {
    const { events, offset: next } = store.readEvents(session.id, offset);
    offset = next;
    for (const event of events) {
      const line = renderEvent(event, context.terminal.colour);
      if (line) context.terminal.out(line);
    }
  };
  drain();

  if (!options.follow) {
    context.terminal.out(renderUsage(session.costUsd, session.steps, session.filesChanged));
    return 0;
  }

  const pollMs = options.pollMs ?? 400;
  for (;;) {
    if (options.until?.()) break;
    const current = store.load(session.id);
    drain();
    if (!current || current.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  drain();
  return 0;
}

export async function undoCommand(context: CommandContext): Promise<number> {
  const result = await undoCheckpoint(context.root);
  if (!result.ok) {
    context.terminal.err(result.message);
    const points = await listCheckpoints(context.root, 5);
    if (points.length > 0) {
      context.terminal.err("Recent checkpoints:");
      for (const point of points) context.terminal.err(`  ${point}`);
    }
    return 1;
  }
  context.terminal.out(result.message);
  return 0;
}

export async function resumeCommand(
  context: CommandContext,
  id: string | undefined,
  instruction: string,
): Promise<number> {
  const store = new SessionStore(context.root);
  const session = id ? store.load(id) : store.latest();
  if (!session) {
    context.terminal.err(id ? `No session ${id} in this workspace.` : "No sessions to resume.");
    return 1;
  }
  const goal =
    instruction.trim() ||
    `Continue the previous task: ${session.goal}. It stopped because: ${session.stoppedBecause || "unknown"}.`;
  const { code } = await runCommand(context, goal, { resume: session });
  return code;
}

// The rest of the command surface. None of these reach a model, which is why
// they run with no key configured: a broken setup is exactly when you need
// `doctor` and `sessions` to work.

export function toolsCommand(context: CommandContext): number {
  const rows = toolCatalogue().map((entry) => {
    const definition = TOOLS[entry.name] as ToolDefinition;
    const gate = gateFor(definition, context);
    return { name: entry.name, gate, description: entry.description };
  });
  const nameWidth = Math.max(...rows.map((r) => r.name.length));
  const gateWidth = Math.max(...rows.map((r) => r.gate.length));
  for (const row of rows) {
    context.terminal.out(
      `${row.name.padEnd(nameWidth)}  ${row.gate.padEnd(gateWidth)}  ${row.description}`,
    );
  }
  return 0;
}

/** What this tool will do when the agent reaches for it, under the autonomy in
 *  force. Computed from the same policy the run uses, not a second table that
 *  could drift away from it. */
function gateFor(definition: ToolDefinition, context: CommandContext): string {
  if (requiresPerson(definition.name)) return "you do it";
  const verdict = evaluate(
    {
      actionId: "catalogue",
      taskId: "catalogue",
      userId: "",
      projectId: context.root,
      operation: definition.operation,
      resources: [],
      environment: "development",
    },
    { autonomy: context.autonomy ?? "ask_sensitive" },
  );
  return verdict.decision === "allow" ? "runs" : `asks (${verdict.riskLevel})`;
}

export async function checkpointsCommand(context: CommandContext): Promise<number> {
  if (!isRepo(context.root)) {
    context.terminal.err("Not a git repository, so there are no checkpoints.");
    return 1;
  }
  const points = await listCheckpoints(context.root, 50);
  if (points.length === 0) {
    context.terminal.out(
      "No checkpoints yet. The agent makes one after a turn that changes a file.",
    );
    return 0;
  }
  for (const point of points) context.terminal.out(point);
  return 0;
}

export async function diffCommand(context: CommandContext): Promise<number> {
  if (!isRepo(context.root)) {
    context.terminal.err("Not a git repository, so there is nothing to diff against.");
    return 1;
  }
  const base = await checkpointBase(context.root);
  // Against the last commit that was not the agent's, so this shows the
  // agent's work as one change rather than one commit at a time.
  const command = base ? `git diff ${base}` : "git diff HEAD";
  const result = await runShell(command, { cwd: context.root, timeoutMs: 60_000 });
  if (!result.ok) {
    context.terminal.err(result.stderr || "git diff failed.");
    return 1;
  }
  context.terminal.out(result.stdout.trim() || "The agent has not changed anything yet.");
  return 0;
}

export function configCommand(context: CommandContext): number {
  const lines = [
    `workspace   ${context.root}`,
    `git         ${isRepo(context.root) ? "yes" : "no, so there are no checkpoints and no undo"}`,
    // What a run would actually use, not what this command happens to hold:
    // `config` is one of the commands that runs without a provider, so reading
    // it off the context would always say "none configured".
    `provider    ${context.provider ? `${context.provider.name}/${context.provider.model}` : (configuredProviderName() ?? "none configured, set ANTHROPIC_API_KEY or OPENROUTER_API_KEY")}`,
    `autonomy    ${context.autonomy ?? "ask_sensitive"}`,
    `max steps   ${context.maxSteps ?? 40}`,
    `budget      ${context.maxCostUsd ? `$${context.maxCostUsd}` : "none set"}`,
    `approvals   ${context.yes ? "auto-approved (--yes)" : "asked in the terminal"}`,
  ];
  for (const line of lines) context.terminal.out(line);
  return 0;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

/** Separated from the printing so the checks themselves can be asserted on. */
export async function runChecks(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<Check[]> {
  const checks: Check[] = [];

  const provider = configuredProviderName(env);
  checks.push({
    name: "model provider",
    ok: provider !== null,
    detail: provider ?? "set ANTHROPIC_API_KEY, or OPENROUTER_API_KEY",
  });

  const git = await runShell("git --version", { cwd: root, timeoutMs: 15_000 });
  checks.push({
    name: "git",
    ok: git.ok,
    detail: git.ok ? git.stdout.trim() : "not found, so checkpoints and undo will not work",
  });

  checks.push({
    name: "workspace",
    ok: existsSync(root),
    detail: isRepo(root) ? `${root} (a git repository)` : `${root} (not a git repository)`,
  });

  // Writable is not the same as existing, and a read-only checkout fails in a
  // confusing way much later if this is not said up front.
  let writable = false;
  try {
    accessSync(root, constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({
    name: "write access",
    ok: writable,
    detail: writable ? "the agent can edit files here" : "no write access to this directory",
  });

  checks.push({
    name: "runtime",
    ok: true,
    detail: `bun ${typeof Bun === "undefined" ? "not detected" : Bun.version}`,
  });

  return checks;
}

export async function doctorCommand(context: CommandContext): Promise<number> {
  const checks = await runChecks(context.root);
  for (const check of checks) {
    context.terminal.out(`${check.ok ? "ok  " : "no  "}${check.name.padEnd(15)}${check.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    context.terminal.err(`${failed.length} thing(s) need attention before a run will work.`);
    return 1;
  }
  return 0;
}

// --- memory --------------------------------------------------------------

export async function indexCommand(context: CommandContext): Promise<number> {
  const embeddings = embeddingsFromEnv();
  const store = openStore(context.root);
  try {
    const result = await indexWorkspace(context.root, { store, embeddings });
    context.terminal.out(
      `${result.scanned} file(s) scanned, ${result.reindexed} indexed, ${result.removed} removed. ` +
        `${store.chunkCount} chunk(s) in the index.`,
    );
    if (embeddings) {
      context.terminal.out(
        result.embedded > 0
          ? `${result.embedded} chunk(s) embedded with ${embeddings.model}.`
          : `Nothing new to embed with ${embeddings.model}.`,
      );
    } else {
      // Said rather than left as a silent difference in quality.
      context.terminal.out(
        "Searching by word only. Set VOYAGE_API_KEY or OPENAI_API_KEY to also search by meaning.",
      );
    }
    return 0;
  } finally {
    store.close();
  }
}

export function memoryCommand(context: CommandContext): number {
  const entries = readMemory(context.root);
  if (entries.length === 0) {
    context.terminal.out(
      "Nothing remembered about this project yet. The agent adds to this as it learns.",
    );
    return 0;
  }
  for (const entry of entries) context.terminal.out(formatEntry(entry));
  context.terminal.out("");
  context.terminal.out(memoryPath(context.root));
  return 0;
}
