import { listCheckpoints, undoCheckpoint } from "../git";
import { Orchestrator, type AgentEvent, type ApprovalRequest } from "../orchestrator";
import { SessionStore, type SessionRecord } from "../session-store";
import { Workspace } from "../workspace";
import type { ModelProvider, ProviderMessage } from "../providers";
import { renderApproval, renderEvent, renderSessions, renderUsage } from "./render";

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

export async function runCommand(
  context: CommandContext,
  goal: string,
  options: { resume?: SessionRecord } = {},
): Promise<{ code: number; session: SessionRecord }> {
  const { terminal } = context;
  const workspace = new Workspace(context.root);
  const store = new SessionStore(context.root);

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
    return { code: result.ok ? 0 : 1, session };
  } catch (error) {
    // A crash still leaves a session on disk that `resume` can pick up; the
    // point of persisting after every message is that this case is survivable.
    session.status = "failed";
    session.stoppedBecause = error instanceof Error ? error.message : String(error);
    store.save(session);
    terminal.err(`Run failed: ${session.stoppedBecause}`);
    terminal.err(`Resume it with: agent resume ${session.id}`);
    return { code: 1, session };
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
