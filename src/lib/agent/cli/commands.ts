import { accessSync, constants, existsSync } from "node:fs";
import { checkpointBase, isRepo, listCheckpoints, undoCheckpoint } from "../git";
import { listSnapshots, undoSnapshot } from "../snapshots";
import { evaluate } from "../policy";
import { runShell } from "../shell";
import { requiresPerson, toolCatalogue, TOOLS, type ToolDefinition } from "../tools";
import {
  DEFAULT_BASE_URL,
  PROVIDER_IDS,
  SETTING_KEYS,
  credentialsPath,
  globalConfigPath,
  maskKey,
  projectConfigPath,
  readCredentials,
  readSettingsFile,
  resolveSettings,
  writeCredentials,
  writeSettingsFile,
  type ProviderId,
  type SettingKey,
} from "../providers";
import { embeddingsFromEnv } from "../memory/embeddings";
import { indexWorkspace, openStore } from "../memory/workspace-index";
import { formatEntry, memoryPath, readMemory } from "../memory/project-memory";
import { McpHub, configPaths, loadConfig } from "../mcp";
import { hostExecutor, type Executor } from "../executor";
import {
  probeImage,
  probeProblem,
  readinessProblem,
  sandboxExecutor,
  sandboxReadiness,
  userFlag,
} from "../sandbox-exec";
import { SANDBOX_ADDENDUM } from "../system-prompt";
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
  /** Ask without echoing what is typed, for API keys. Absent where there is no
   *  terminal to mute, and callers fall back to ask(). */
  askSecret?(question: string): Promise<string>;
  /** Write without a newline, for text arriving a piece at a time. Absent on a
   *  terminal that cannot usefully stream, such as a pipe, and the caller then
   *  prints the finished text once instead. */
  write?(text: string): void;
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
  /** Run commands in a container. Default on; see buildExecutor. */
  sandbox?: boolean;
  /** Print machine-readable output. Honoured by the commands that report
   *  rather than act: config, sessions, checkpoints and tools. The flag was
   *  advertised in --help for a while and read by nothing, so `--json` printed
   *  the same prose and a script parsing it got a surprise. */
  json?: boolean;
  /** An executor built once for a whole session. When absent, a run builds its
   *  own and disposes it. */
  executor?: Executor;
}

/**
 * The executor for a run, or the reason there cannot be one.
 *
 * Refuses rather than quietly falling back to the host. Somebody who believes
 * they are sandboxed and is not is worse off than somebody who knows they are
 * not, so the only way to the weaker mode is to ask for it.
 */
export async function buildExecutor(
  root: string,
  sandbox: boolean,
  warn: (message: string) => void = (message) => process.stderr.write(`warning: ${message}\n`),
): Promise<{ executor: Executor } | { problem: string }> {
  if (!sandbox) return { executor: hostExecutor() };

  const readiness = await sandboxReadiness();
  const problem = readinessProblem(readiness);
  if (problem) return { problem };

  // The image is checked against what this project is actually built with, so
  // a missing toolchain is named up front rather than arriving as
  // "cargo: not found" in the middle of a run.
  const probe = await probeImage(root, readiness.imageName, readiness.runtimeName);
  const mismatch = probeProblem(probe, readiness.imageName);
  // Said, not enforced: a missing toolchain breaks the commands that need it,
  // not the session. See probeProblem.
  if (mismatch) warn(mismatch);

  return { executor: sandboxExecutor({ workspace: root }) };
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
  options: {
    resume?: SessionRecord;
    offerPersonTools?: string[];
    systemAddendum?: string;
    /** Leave out the session header. The second turn of a conversation does
     *  not need to be told which session it is in. */
    quiet?: boolean;
  } = {},
): Promise<RunOutcome> {
  const { terminal } = context;
  const workspace = new Workspace(context.root);
  const store = new SessionStore(context.root);

  // A session builds one executor and hands it down, so a conversation is not
  // paying for a new container every turn and losing /tmp between them. A
  // one-shot run builds its own, and disposes only what it built.
  let executor = context.executor;
  const owned = !executor;
  if (!executor) {
    const built = await buildExecutor(context.root, context.sandbox ?? true);
    if ("problem" in built) {
      terminal.err(built.problem);
      return {
        code: 2,
        session: store.create(goal, {
          provider: context.provider.name,
          model: context.provider.model,
        }),
      };
    }
    executor = built.executor;
  }

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

  // MCP servers, if any are configured. Started per run rather than kept alive
  // across the session: a server that died between turns would otherwise stay
  // in the tool list, and offering a tool that cannot run is worse than not
  // offering it.
  const mcp = await McpHub.start(loadConfig(context.root));
  for (const status of mcp.status) {
    if (status.ok) terminal.out(`mcp ${status.server}: ${status.tools} tool(s)`);
    else terminal.err(`mcp ${status.server}: ${status.error}`);
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

  if (!options.quiet) {
    terminal.out(`session ${session.id}  ${context.provider.name}/${context.provider.model}`);
    terminal.out(`commands run ${executor.describe}`);
    terminal.out(`goal: ${goal}`);
  }
  terminal.out("");

  const prior: ProviderMessage[] = options.resume ? options.resume.messages : [];

  // Streaming, when there is somebody watching. The model's prose arrives a
  // token at a time and a run takes minutes; printing it as it comes is the
  // difference between watching something work and staring at nothing. Off
  // when the output is a pipe, where a half-written line is just a broken log.
  const streaming = typeof terminal.write === "function";
  let midStream = false;
  const endStream = () => {
    if (!midStream) return;
    terminal.write?.("\n");
    midStream = false;
  };

  const orchestrator = new Orchestrator({
    provider: context.provider,
    workspace,
    onDelta: streaming
      ? (chunk) => {
          midStream = true;
          terminal.write?.(chunk);
        }
      : undefined,
    autonomy: context.autonomy,
    maxSteps: context.maxSteps,
    maxCostUsd: context.maxCostUsd,
    signal: context.signal,
    taskId: session.id,
    projectId: context.root,
    requestApproval: approver(context),
    executor,
    memory,
    embeddings,
    mcp,
    offerPersonTools: options.offerPersonTools,
    // The agent has to know its shell has no network, or it will try to reach
    // it and read the failure as its own mistake.
    systemAddendum:
      (executor.kind === "sandbox" ? SANDBOX_ADDENDUM : "") + (options.systemAddendum ?? ""),
    onEvent: (event: AgentEvent) => {
      // The log is written before the line is printed: what a watching
      // terminal sees should never lag behind what this one shows.
      store.appendEvent(session.id, event);
      const line = renderEvent(event, terminal.colour);
      if (!line) return;
      // A step line landing in the middle of a half-written sentence is how
      // streaming output turns into soup.
      endStream();
      terminal.out(line);
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

    endStream();
    terminal.out("");
    // Already on screen if it was streamed. Printing it twice is the most
    // obvious way to make streaming look broken.
    if (!streaming) terminal.out(result.summary);
    terminal.out(renderUsage(result.costUsd, result.steps, result.filesChanged));
    if (!result.ok) terminal.err(result.stoppedBecause);
    return { code: result.ok ? 0 : 1, session, result };
  } catch (error) {
    endStream();
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
    mcp.stop();
    if (owned) await executor.dispose();
  }
}

export function sessionsCommand(context: CommandContext): number {
  const store = new SessionStore(context.root);
  const sessions = store.list();
  if (context.json) {
    // The stored records themselves, not a re-description of them: a script
    // reading this wants the fields, and anything omitted here is a field it
    // cannot get at all.
    context.terminal.out(JSON.stringify({ sessions }, null, 2));
    return 0;
  }
  context.terminal.out(renderSessions(sessions));
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
  // Whichever safety net this workspace has. Git where it exists, snapshots
  // where it does not: undo is not a feature only version-controlled projects
  // are allowed to have.
  const result = isRepo(context.root)
    ? await undoCheckpoint(context.root)
    : undoSnapshot(context.root);
  if (!result.ok) {
    context.terminal.err(result.message);
    const points = isRepo(context.root)
      ? await listCheckpoints(context.root, 5)
      : listSnapshots(context.root)
          .slice(0, 5)
          .map((snap) => `${snap.id}\t${snap.message}`);
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
  if (context.json) {
    context.terminal.out(JSON.stringify({ tools: rows }, null, 2));
    return 0;
  }
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
  const usesGit = isRepo(context.root);
  const points = usesGit
    ? await listCheckpoints(context.root, 50)
    : listSnapshots(context.root).map((snap) => `${snap.id}\t${snap.message}`);
  if (context.json) {
    // The two paths are different things and the shape says so, rather than
    // flattening a commit and a snapshot into one look-alike record.
    context.terminal.out(
      JSON.stringify(
        {
          kind: usesGit ? "git" : "snapshot",
          checkpoints: points.map((line) => {
            const [id, ...rest] = line.split("\t");
            return { id, message: rest.join("\t") };
          }),
        },
        null,
        2,
      ),
    );
    return 0;
  }
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
    // Honest rather than approximated. A snapshot restores a whole workspace;
    // it holds no base to diff against the way a commit does, and printing a
    // file-by-file comparison here would be a different thing wearing the same
    // name. `checkpoints` lists what can be undone.
    context.terminal.err(
      "This workspace is not a git repository, so there is no commit to diff against. " +
        "Checkpoints still exist here: run `devstation checkpoints` to see them, " +
        "or `devstation undo` to go back one turn.",
    );
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
  if (context.json) {
    context.terminal.out(
      JSON.stringify(
        {
          workspace: context.root,
          git: isRepo(context.root),
          provider: context.provider
            ? { name: context.provider.name, model: context.provider.model }
            : (() => {
                const r = resolveSettings({ root: context.root });
                return {
                  name: r.provider,
                  model: r.model,
                  baseUrl: r.baseUrl,
                  key: maskKey(r.apiKey),
                  source: r.source,
                  problem: r.problem,
                };
              })(),
          autonomy: context.autonomy ?? "ask_sensitive",
          maxSteps: context.maxSteps ?? 40,
          budgetUsd: context.maxCostUsd ?? null,
          autoApprove: !!context.yes,
          sandbox: context.sandbox !== false,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  // What a run would actually use, not what this command happens to hold:
  // `config` runs without a provider, so reading it off the context would
  // always say "none configured". Each value says where it came from, because
  // "why is it using that model" is the question this command exists for.
  const r = resolveSettings({ root: context.root });
  const lines = [
    `workspace   ${context.root}`,
    `git         ${isRepo(context.root) ? "yes" : "no, so checkpoints are file snapshots under .devstation/"}`,
    // Inside a session the provider is already chosen and running, and that is
    // the true answer. Resolving settings again there could name a different
    // one than the conversation is actually using.
    context.provider
      ? `provider    ${context.provider.name}/${context.provider.model}  (this session)`
      : `provider    ${r.provider ?? "none"}  (${r.source.provider})`,
    `model       ${context.provider ? context.provider.model : (r.model ?? "provider default")}  (${context.provider ? "this session" : r.source.model})`,
    `endpoint    ${r.baseUrl ?? (r.provider ? DEFAULT_BASE_URL[r.provider] : "none")}  (${r.source.baseUrl})`,
    `api key     ${maskKey(r.apiKey)}  (${r.source.apiKey})`,
    `autonomy    ${context.autonomy ?? "ask_sensitive"}`,
    `max steps   ${context.maxSteps ?? 40}`,
    `budget      ${context.maxCostUsd ? `$${context.maxCostUsd}` : "none set"}`,
    `approvals   ${context.yes ? "auto-approved (--yes)" : "asked in the terminal"}`,
  ];
  for (const line of lines) context.terminal.out(line);
  if (r.problem && !context.provider) context.terminal.err(`\n${r.problem}`);
  for (const warning of r.warnings) context.terminal.err(`warning: ${warning}`);
  return 0;
}

function home(): string {
  return process.env.HOME ?? "";
}

/**
 * Warn when a session starts in a home directory.
 *
 * Everything under it becomes one workspace: the agent indexes, searches and
 * can edit every repository kept there, and the project scan finds all of
 * their manifests. That is almost never what somebody meant, so it is said up
 * front -- as a warning, since it is occasionally exactly what they meant.
 */
export function homeDirectoryWarning(
  root: string,
  homeDir = process.env.HOME ?? "",
): string | null {
  if (!homeDir) return null;
  const strip = (p: string) => p.replace(/\/+$/, "");
  if (strip(root) !== strip(homeDir)) return null;
  return (
    "You are in your home directory, so the agent treats everything under it as one project, " +
    "every repository inside it included. cd into the project you mean first."
  );
}

/** `config set|get|unset <key> [value]` and `config path`. */
export function configEditCommand(
  context: CommandContext,
  rest: string,
  opts: { project?: boolean } = {},
): number {
  const [action, key, ...valueWords] = rest.trim().split(/\s+/);
  const value = valueWords.join(" ").trim();
  const path = opts.project ? projectConfigPath(context.root) : globalConfigPath(home());

  if (action === "path") {
    context.terminal.out(`global       ${globalConfigPath(home())}`);
    context.terminal.out(`project      ${projectConfigPath(context.root)}`);
    context.terminal.out(`credentials  ${credentialsPath(home())}`);
    return 0;
  }

  if (key === "apiKey" || key === "key") {
    // Keys go through login, into the owner-only credentials file. A key in
    // config.json is a key in whatever that file gets shared or committed with.
    context.terminal.err(
      `API keys are not stored in config. Run \`devstation login\` to store one in ${credentialsPath(home())}.`,
    );
    return 2;
  }
  if (!key || !(SETTING_KEYS as readonly string[]).includes(key)) {
    context.terminal.err(`Unknown setting "${key ?? ""}". Settings: ${SETTING_KEYS.join(", ")}.`);
    return 2;
  }
  const name = key as SettingKey;
  const current = readSettingsFile(path);

  if (action === "get") {
    context.terminal.out(current[name] ?? "");
    return 0;
  }
  if (action === "unset") {
    delete current[name];
    writeSettingsFile(path, current);
    context.terminal.out(`Removed ${name} from ${path}.`);
    return 0;
  }
  if (action === "set") {
    if (!value) {
      context.terminal.err(`Give it a value: devstation config set ${name} <value>`);
      return 2;
    }
    if (name === "provider" && !(PROVIDER_IDS as readonly string[]).includes(value.toLowerCase())) {
      context.terminal.err(`Unknown provider "${value}". Providers: ${PROVIDER_IDS.join(", ")}.`);
      return 2;
    }
    if (name === "baseUrl" && !/^https?:\/\//.test(value)) {
      context.terminal.err("baseUrl must start with http:// or https://.");
      return 2;
    }
    (current as Record<string, string>)[name] =
      name === "baseUrl"
        ? value.replace(/\/+$/, "")
        : name === "provider"
          ? value.toLowerCase()
          : value;
    writeSettingsFile(path, current);
    context.terminal.out(`Set ${name} = ${(current as Record<string, string>)[name]} in ${path}.`);
    return 0;
  }

  context.terminal.err(
    "Use: devstation config set <key> <value> | get <key> | unset <key> | path   (add --project for this workspace)",
  );
  return 2;
}

/**
 * Store a key, and optionally a model and endpoint, the way `claude` and
 * `codex` set themselves up: once, interactively, and then every new shell just
 * works.
 *
 * The key is read without echo on a terminal and never printed back, not even
 * in the confirmation, which shows only enough of it to tell two apart. Piped
 * input works too, so `echo "$KEY" | devstation login openrouter` is scriptable.
 */
export async function loginCommand(context: CommandContext, rest: string): Promise<number> {
  const t = context.terminal;
  const secret = t.askSecret ? (q: string) => t.askSecret!(q) : (q: string) => t.ask(q);

  let provider = (rest.trim().split(/\s+/)[0] ?? "").toLowerCase() as ProviderId | "";
  if (!provider) {
    t.out("Which provider?");
    t.out("  anthropic   Claude, directly (prompt caching, native tool use)");
    t.out("  openrouter  one key for Claude, GPT, Gemini, DeepSeek and more");
    t.out("  openai      OpenAI, or any compatible server: Ollama, LM Studio, Groq, Together");
    provider = ((await t.ask("provider [anthropic]: ")).trim().toLowerCase() ||
      "anthropic") as ProviderId;
  }
  if (!(PROVIDER_IDS as readonly string[]).includes(provider)) {
    t.err(`Unknown provider "${provider}". Providers: ${PROVIDER_IDS.join(", ")}.`);
    return 2;
  }
  const id = provider as ProviderId;

  let baseUrl = "";
  if (id === "openai") {
    baseUrl = (await t.ask(`endpoint [${DEFAULT_BASE_URL.openai}]: `)).trim();
    if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
      t.err("The endpoint must start with http:// or https://.");
      return 2;
    }
  }

  const key = (
    await secret(id === "openai" ? "API key (blank for a local server): " : "API key: ")
  ).trim();
  if (!key && id !== "openai") {
    t.err("No key entered, so nothing was saved.");
    return 2;
  }

  const modelHint =
    id === "anthropic"
      ? "claude-sonnet-5"
      : id === "openrouter"
        ? "anthropic/claude-sonnet-5"
        : "required";
  const model = (await t.ask(`model [${modelHint}]: `)).trim();
  if (id === "openai" && !model) {
    t.err(
      "The openai provider needs a model name, because every compatible server names them differently.",
    );
    return 2;
  }

  const h = home();
  if (!h) {
    t.err("HOME is not set, so there is nowhere to store settings.");
    return 2;
  }

  if (key) {
    const credentials = readCredentials(h);
    credentials[id] = key;
    writeCredentials(h, credentials);
  }
  const settings = readSettingsFile(globalConfigPath(h));
  settings.provider = id;
  if (model) settings.model = model;
  else delete settings.model;
  if (baseUrl) settings.baseUrl = baseUrl.replace(/\/+$/, "");
  else if (id !== "openai") delete settings.baseUrl;
  writeSettingsFile(globalConfigPath(h), settings);

  t.out("");
  t.out(
    `Saved. provider ${id}, model ${model || "provider default"}${baseUrl ? `, endpoint ${baseUrl}` : ""}`,
  );
  if (key) t.out(`key ${maskKey(key)} in ${credentialsPath(h)} (readable only by you)`);
  t.out(`settings in ${globalConfigPath(h)}`);
  t.out("");
  t.out("Check it with: devstation doctor");
  return 0;
}

/** Remove stored keys: one provider's, or all of them. Settings stay. */
export function logoutCommand(context: CommandContext, rest: string): number {
  const h = home();
  const target = (rest.trim().split(/\s+/)[0] ?? "").toLowerCase() as ProviderId | "";
  if (target && !(PROVIDER_IDS as readonly string[]).includes(target)) {
    context.terminal.err(`Unknown provider "${target}". Providers: ${PROVIDER_IDS.join(", ")}.`);
    return 2;
  }
  const credentials = readCredentials(h);
  const removed = target
    ? credentials[target as ProviderId]
      ? [target]
      : []
    : Object.keys(credentials);
  if (removed.length === 0) {
    context.terminal.out(target ? `No stored key for ${target}.` : "No stored keys.");
    return 0;
  }
  if (target) delete credentials[target as ProviderId];
  writeCredentials(h, target ? credentials : {});
  context.terminal.out(`Removed the stored key for ${removed.join(", ")}.`);
  context.terminal.out(
    "Keys exported in your shell (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY) are not touched.",
  );
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

  const settings = resolveSettings({ root, env });
  checks.push({
    name: "model provider",
    ok: settings.problem === null,
    detail:
      settings.problem ??
      `${settings.provider}${settings.model ? `/${settings.model}` : ""}, key from ${settings.source.apiKey}`,
  });
  for (const warning of settings.warnings) {
    checks.push({ name: "settings", ok: false, detail: warning });
  }

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

  // The sandbox, reported rather than required. This is the command people run
  // when the agent will not start, so it must work on a machine where the
  // sandbox cannot.
  const sandbox = await sandboxReadiness(env);
  checks.push({
    name: "docker",
    ok: sandbox.docker,
    detail: sandbox.docker ? "reachable" : "not running, so commands cannot be sandboxed",
  });
  checks.push({
    name: "isolation",
    ok: sandbox.runtime,
    detail: sandbox.runtime
      ? `${sandbox.runtimeName}, a user-space kernel between commands and this host`
      : `${sandbox.runtimeName} is not registered with docker`,
  });
  checks.push({
    name: "sandbox image",
    ok: sandbox.image,
    detail: sandbox.image
      ? `${sandbox.imageName}, running as ${userFlag()}` +
        (userFlag().startsWith("0:") ? " (root inside the container)" : "")
      : `${sandbox.imageName} is not built: bun run sandbox:image`,
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

export async function mcpCommand(context: CommandContext): Promise<number> {
  const config = loadConfig(context.root);
  const names = Object.keys(config.mcpServers);

  if (names.length === 0) {
    context.terminal.out("No MCP servers configured. Looked in:");
    for (const path of configPaths(context.root)) context.terminal.out(`  ${path}`);
    context.terminal.out("");
    context.terminal.out('A file holding {"mcpServers": {"name": {"command": "...", "args": []}}}');
    context.terminal.out("adds that server's tools to every run in this project.");
    return 0;
  }

  // Actually started, not just listed. A server that is configured and broken
  // looks identical to one that works until something tries it.
  const hub = await McpHub.start(config);
  try {
    for (const status of hub.status) {
      context.terminal.out(
        status.ok
          ? `ok  ${status.server.padEnd(16)} ${status.tools} tool(s)`
          : `no  ${status.server.padEnd(16)} ${status.error}`,
      );
    }
    for (const tool of hub.tools) {
      context.terminal.out(`      ${tool.name.padEnd(28)} ${tool.description.slice(0, 60)}`);
    }
    const disabled = names.filter((n) => config.mcpServers[n].disabled);
    for (const name of disabled) context.terminal.out(`--  ${name.padEnd(16)} disabled`);
    return hub.status.every((s) => s.ok) ? 0 : 1;
  } finally {
    hub.stop();
  }
}
