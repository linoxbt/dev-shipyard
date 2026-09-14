import { spawn } from "node:child_process";
import { isAbsolute, relative } from "node:path";
import type { AgentEvent, RunResult } from "../orchestrator";
import {
  EMPTY_USAGE,
  ENGINE_BINARY,
  ENGINE_INSTALL,
  ENGINE_LABEL,
  ENGINE_SIGN_IN,
  globalConfigPath,
  readSettingsFile,
  writeSettingsFile,
  type EngineId,
  type ProviderMessage,
  type ProviderUsage,
} from "../providers";
import { SessionStore, type SessionRecord } from "../session-store";
import { CLI_NAME } from "./args";
import type { CommandContext, RunOutcome } from "./commands";
import { LiveView, clip, formatElapsed } from "./live";
import { paint, renderEvent, renderStopped } from "./render";

// A turn handed to Claude Code or Codex, signed in with the person's own Claude
// or ChatGPT plan.
//
// DevStation never holds those sign-ins. It runs the official program -- the
// `claude` or `codex` the person installed and logged in to -- with the prompt
// on standard input, reads the JSON stream it prints, and draws it the way
// DevStation draws its own turns: text as it arrives, every command and edit as
// a cell, todo lists, a receipt. The engine keeps its own conversation, and the
// session stores its id so the next turn resumes it.
//
// Nobody can answer a permission prompt in the middle of such a turn, so the
// engine's own unattended modes decide: Claude Code's auto mode, where a
// classifier reviews each action, and Codex writing inside the project. Plan
// mode maps to each one's read-only mode.

type Json = Record<string, unknown>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : value === undefined || value === null ? "" : String(value);
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const PLAN_NOTE =
  "Plan mode: read, search and look things up, then propose a plan. Change nothing yet.";

export interface EngineSink {
  delta(text: string): void;
  event(event: AgentEvent): void;
}

export interface EngineTotals {
  ok: boolean;
  /** The engine's own conversation id, for resuming it. */
  sessionId: string | null;
  summary: string;
  stoppedBecause: string;
  steps: number;
  filesChanged: string[];
  usage: ProviderUsage;
}

export interface EngineExit {
  code: number | null;
  stderr: string;
  /** Set when the program could not be run at all. */
  error?: string;
}

function agentEvent(
  kind: AgentEvent["kind"],
  tool?: string,
  detail?: Json,
  message = "",
): AgentEvent {
  // A log without a live view prints the message beside the tool: say what it
  // ran or touched.
  const input = obj(detail?.input);
  return {
    kind,
    message: message || str(input.command || input.path || input.query || input.url),
    at: new Date().toISOString(),
    ...(tool ? { tool } : {}),
    ...(detail ? { detail } : {}),
    ...(kind === "step.completed" ? { ok: true } : kind === "step.failed" ? { ok: false } : {}),
  };
}

/** The command line for one turn. The prompt goes in on standard input, where
 *  it cannot be taken for a flag and no argument length limit applies. */
export function engineInvocation(
  engine: EngineId,
  opts: { model?: string | null; resume?: string; plan: boolean },
): { command: string; args: string[] } {
  const model = opts.model && opts.model !== "default" ? opts.model : null;
  if (engine === "claude-code") {
    return {
      command: ENGINE_BINARY[engine],
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        opts.plan ? "plan" : "auto",
        ...(model ? ["--model", model] : []),
        ...(opts.resume ? ["--resume", opts.resume] : []),
      ],
    };
  }
  // `exec resume` takes neither --sandbox nor -C, so the sandbox is set as
  // configuration and the directory is the one the process starts in.
  const settings = [
    "-c",
    `sandbox_mode="${opts.plan ? "read-only" : "workspace-write"}"`,
    "-c",
    "sandbox_workspace_write.network_access=true",
    ...(model ? ["-m", model] : []),
  ];
  return {
    command: ENGINE_BINARY[engine],
    args: opts.resume
      ? ["exec", "resume", "--json", "--skip-git-repo-check", ...settings, opts.resume, "-"]
      : ["exec", "--json", "--skip-git-repo-check", ...settings, "-"],
  };
}

interface Call {
  tool: string;
  input: Json;
  /** The file this call writes, when it writes one. */
  changes?: string;
}

function shownPath(path: string, root: string): string {
  if (!path || !isAbsolute(path)) return path;
  const inside = relative(root, path);
  return inside && !inside.startsWith("..") && !isAbsolute(inside) ? inside : path;
}

/** A Claude Code tool call as the DevStation tool that draws the same cell. */
export function claudeToolCall(name: string, input: Json, root: string): Call {
  const path = (value: unknown) => shownPath(str(value), root);
  switch (name) {
    case "Bash":
      return {
        tool: "run_shell",
        input: { command: str(input.command), background: input.run_in_background === true },
      };
    case "Read":
      return { tool: "read_file", input: { path: path(input.file_path) } };
    case "Write":
      return {
        tool: "write_file",
        input: { path: path(input.file_path), lines: str(input.content).split("\n").length },
        changes: path(input.file_path),
      };
    case "Edit":
    case "MultiEdit":
      return {
        tool: "edit_file",
        input: { path: path(input.file_path) },
        changes: path(input.file_path),
      };
    case "NotebookEdit":
      return {
        tool: "edit_file",
        input: { path: path(input.notebook_path) },
        changes: path(input.notebook_path),
      };
    case "Glob":
    case "Grep":
      return { tool: "search_files", input: { query: str(input.pattern) } };
    case "LS":
      return { tool: "list_files", input: { path: path(input.path) } };
    case "WebSearch":
      return { tool: "web_search", input: { query: str(input.query) } };
    case "WebFetch":
      return { tool: "fetch_url", input: { url: str(input.url) } };
    case "TodoWrite":
      return {
        tool: "update_plan",
        input: {
          plan: list(input.todos).map((todo) => ({
            step: str(obj(todo).content),
            status: str(obj(todo).status),
          })),
        },
      };
    case "BashOutput":
    case "TaskOutput":
      return {
        tool: "shell_output",
        input: { id: str(input.bash_id ?? input.task_id ?? input.shell_id) },
      };
    case "KillShell":
    case "KillBash":
    case "TaskStop":
      return {
        tool: "stop_shell",
        input: { id: str(input.shell_id ?? input.bash_id ?? input.task_id) },
      };
    case "Task":
    case "Agent":
      return { tool: `Agent(${clip(str(input.description) || "subagent", 60)})`, input: {} };
    default:
      return { tool: name, input: {} };
  }
}

/** `/bin/bash -lc 'npm test'` is how Codex reports `npm test`. */
export function codexCommand(raw: string): string {
  const inner = raw.replace(/^(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+/, "");
  if (inner === raw) return raw;
  const single = /^'([\s\S]*)'$/.exec(inner);
  if (single) return single[1].replace(/'\\''/g, "'");
  const double = /^"([\s\S]*)"$/.exec(inner);
  return double ? double[1] : inner;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  return list(content)
    .map((part) => str(obj(part).text))
    .filter(Boolean)
    .join("\n");
}

/** Codex puts the API's own JSON error inside `message`; the sentence inside
 *  that is what a person needs to read. */
function errorText(value: unknown): string {
  const text = typeof value === "string" ? value : str(obj(value).message);
  if (!text.trimStart().startsWith("{")) return text;
  try {
    const parsed = obj(JSON.parse(text));
    return str(obj(parsed.error).message) || str(parsed.message) || text;
  } catch {
    return text;
  }
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[A-Za-z]`, "g");

function lastLines(text: string, count = 2): string {
  return text
    .replace(ANSI, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-count)
    .join(" ");
}

function withSignInHint(engine: EngineId, reason: string): string {
  if (!/not logged in|log ?in|unauthori[sz]ed|\b401\b|authenticat/i.test(reason)) return reason;
  return `${reason} Run \`${ENGINE_SIGN_IN[engine]}\` in your shell, then try again.`;
}

/** Reads an engine's JSON stream a line at a time and turns it into the same
 *  events and text a DevStation turn produces. */
export class EngineStream {
  private sessionId: string | null = null;
  private ok: boolean | null = null;
  private summary = "";
  private stopped = "";
  private lastError = "";
  private steps = 0;
  private readonly files = new Set<string>();
  private readonly usage: ProviderUsage = { ...EMPTY_USAGE };
  private readonly calls = new Map<string, Call>();
  /** Claude messages whose text already arrived as deltas. */
  private readonly streamed = new Set<string>();
  private finishedOutput = 0;
  private messageOutput = 0;

  constructor(
    private readonly engine: EngineId,
    private readonly root: string,
    private readonly sink: EngineSink,
  ) {}

  /** One line of the engine's output. Anything that is not a JSON object is
   *  left alone: both programs keep their warnings on stderr. */
  feed(line: string) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let parsed: Json;
    try {
      parsed = obj(JSON.parse(trimmed));
    } catch {
      return;
    }
    if (this.engine === "claude-code") this.claude(parsed);
    else this.codex(parsed);
  }

  finish(exit: EngineExit): EngineTotals {
    const ok = this.ok === true;
    let stoppedBecause = this.stopped;
    if (!ok && !stoppedBecause) {
      stoppedBecause = exit.error
        ? `${exit.error} ${ENGINE_INSTALL[this.engine]}, sign in with \`${ENGINE_SIGN_IN[this.engine]}\`, then try again.`
        : this.lastError ||
          lastLines(exit.stderr) ||
          `${ENGINE_BINARY[this.engine]} exited with code ${exit.code ?? "unknown"} before finishing.`;
    }
    return {
      ok,
      sessionId: this.sessionId,
      summary: this.summary,
      stoppedBecause: ok ? "" : withSignInHint(this.engine, stoppedBecause),
      steps: this.steps,
      filesChanged: [...this.files],
      usage: { ...this.usage },
    };
  }

  private note(message: string) {
    this.sink.event(agentEvent("plan", undefined, undefined, message));
  }

  private step(call: Call, failed: boolean, text: string, exitCode: number | null = null) {
    this.steps++;
    if (!failed && call.changes) this.files.add(call.changes);
    const output =
      call.tool === "run_shell" && call.input.background !== true
        ? `exit ${exitCode ?? (failed ? 1 : 0)}\n${text}`
        : text;
    this.sink.event(
      agentEvent(
        failed ? "step.failed" : "step.completed",
        call.tool,
        { input: call.input, output },
        failed ? text.split("\n")[0].slice(0, 200) : "",
      ),
    );
  }

  private claude(e: Json) {
    if (typeof e.session_id === "string" && e.session_id) this.sessionId = e.session_id;
    // A subagent's messages name the call that started it. Its own steps are
    // its business; the call itself is already a cell.
    if (e.parent_tool_use_id) return;
    switch (e.type) {
      case "stream_event": {
        const inner = obj(e.event);
        const delta = obj(inner.delta);
        if (inner.type === "message_start") {
          const id = str(obj(inner.message).id);
          if (id) this.streamed.add(id);
          this.messageOutput = 0;
        } else if (inner.type === "content_block_delta" && delta.type === "text_delta") {
          this.sink.delta(str(delta.text));
        } else if (inner.type === "message_delta") {
          this.messageOutput = Number(obj(inner.usage).output_tokens) || 0;
          this.sink.event(
            agentEvent(
              "usage",
              undefined,
              undefined,
              `${this.finishedOutput + this.messageOutput} output tokens so far`,
            ),
          );
        } else if (inner.type === "message_stop") {
          this.finishedOutput += this.messageOutput;
          this.messageOutput = 0;
        }
        return;
      }
      case "assistant": {
        const message = obj(e.message);
        for (const raw of list(message.content)) {
          const block = obj(raw);
          if (block.type === "text" && !this.streamed.has(str(message.id))) {
            this.sink.delta(`${str(block.text)}\n`);
          } else if (block.type === "tool_use") {
            const call = claudeToolCall(str(block.name), obj(block.input), this.root);
            this.calls.set(str(block.id), call);
            this.sink.event(agentEvent("step.started", call.tool, { input: call.input }));
          }
        }
        return;
      }
      case "user": {
        for (const raw of list(obj(e.message).content)) {
          const block = obj(raw);
          if (block.type !== "tool_result") continue;
          const id = str(block.tool_use_id);
          const call = this.calls.get(id);
          if (!call) continue;
          this.calls.delete(id);
          this.step(call, block.is_error === true, resultText(block.content));
        }
        return;
      }
      case "system":
        if (e.subtype === "permission_denied") {
          this.note(`Not allowed: ${str(e.message) || str(e.tool_name)}`);
        }
        return;
      case "rate_limit_event": {
        const info = obj(e.rate_limit_info);
        if (info.status === "rejected") {
          const resets = Number(info.resetsAt);
          this.note(
            `Your Claude plan's usage limit is reached${resets ? `; it resets ${new Date(resets * 1000).toLocaleString()}` : ""}.`,
          );
        }
        return;
      }
      case "result": {
        this.ok = e.subtype === "success" && e.is_error !== true;
        // A failed turn's result is the error, which belongs in stoppedBecause.
        if (this.ok && typeof e.result === "string") this.summary = e.result.trim();
        if (!this.ok) {
          this.stopped =
            str(e.result) ||
            list(e.errors).map(str).join("; ") ||
            str(e.subtype) ||
            "Claude Code stopped.";
        }
        const usage = obj(e.usage);
        this.usage.inputTokens += Number(usage.input_tokens) || 0;
        this.usage.outputTokens += Number(usage.output_tokens) || 0;
        this.usage.cacheReadTokens += Number(usage.cache_read_input_tokens) || 0;
        this.usage.cacheWriteTokens += Number(usage.cache_creation_input_tokens) || 0;
        return;
      }
      default:
        return;
    }
  }

  private codex(e: Json) {
    const item = obj(e.item);
    switch (e.type) {
      case "thread.started":
        this.sessionId = str(e.thread_id) || this.sessionId;
        return;
      case "item.started":
        if (item.type === "command_execution") {
          this.sink.event(
            agentEvent("step.started", "run_shell", {
              input: { command: codexCommand(str(item.command)) },
            }),
          );
        } else if (item.type === "file_change") {
          const first = obj(list(item.changes)[0]);
          this.sink.event(
            agentEvent("step.started", "edit_file", {
              input: { path: shownPath(str(first.path), this.root) },
            }),
          );
        }
        return;
      case "item.completed":
        this.codexItem(item);
        return;
      case "turn.completed": {
        if (this.ok === null) this.ok = true;
        const usage = obj(e.usage);
        const input = Number(usage.input_tokens) || 0;
        const cached = Number(usage.cached_input_tokens) || 0;
        this.usage.inputTokens += Math.max(0, input - cached);
        this.usage.cacheReadTokens += cached;
        this.usage.outputTokens += Number(usage.output_tokens) || 0;
        this.sink.event(
          agentEvent(
            "usage",
            undefined,
            undefined,
            `${this.usage.outputTokens} output tokens so far`,
          ),
        );
        return;
      }
      case "turn.failed":
        this.ok = false;
        this.stopped = errorText(e.error) || "Codex stopped.";
        return;
      case "error":
        this.lastError = errorText(e.message ?? e.error);
        return;
      default:
        return;
    }
  }

  private codexItem(item: Json) {
    const refused = item.status === "failed" || item.status === "declined";
    switch (item.type) {
      case "agent_message": {
        const text = str(item.text);
        if (!text.trim()) return;
        this.sink.delta(text.endsWith("\n") ? text : `${text}\n`);
        this.summary = text.trim();
        return;
      }
      case "command_execution": {
        const code = typeof item.exit_code === "number" ? item.exit_code : null;
        this.step(
          { tool: "run_shell", input: { command: codexCommand(str(item.command)) } },
          refused || (code !== null && code !== 0),
          str(item.aggregated_output),
          code,
        );
        return;
      }
      case "file_change":
        for (const raw of list(item.changes)) {
          const change = obj(raw);
          const path = shownPath(str(change.path), this.root);
          const tool =
            change.kind === "add"
              ? "write_file"
              : change.kind === "delete"
                ? "delete_file"
                : "edit_file";
          this.step({ tool, input: { path }, changes: path }, refused, "");
        }
        return;
      case "web_search":
        this.step({ tool: "web_search", input: { query: str(item.query) } }, refused, "");
        return;
      case "mcp_tool_call":
        this.step(
          {
            tool: [str(item.server), str(item.tool)].filter(Boolean).join(".") || "MCP tool",
            input: {},
          },
          refused,
          errorText(item.error),
        );
        return;
      case "todo_list":
        this.step(
          {
            tool: "update_plan",
            input: {
              plan: list(item.items).map((raw) => {
                const todo = obj(raw);
                const status =
                  todo.completed === true || todo.status === "completed"
                    ? "completed"
                    : todo.status === "in_progress"
                      ? "in_progress"
                      : "pending";
                return { step: str(todo.text ?? todo.step), status };
              }),
            },
          },
          false,
          "",
        );
        return;
      default:
        return;
    }
  }
}

/** Runs a program with `input` on standard input, handing over its output a
 *  line at a time. Resolves when it exits; never rejects. */
export function spawnEngine(
  command: string,
  args: string[],
  opts: {
    cwd: string;
    input: string;
    onLine: (line: string) => void;
    signal?: AbortSignal;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  },
): Promise<EngineExit> {
  return new Promise((resolve) => {
    let settled = false;
    let stderr = "";
    let buffer = "";
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    // SIGINT ends the turn the way Ctrl-C does inside the engine itself, and
    // lets it record where it stopped. SIGTERM only if that is not enough.
    const stop = () => {
      child.kill("SIGINT");
      const later = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
      }, 3000);
      later.unref?.();
    };
    const timer = opts.timeoutMs ? setTimeout(stop, opts.timeoutMs) : null;
    const done = (exit: EngineExit) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener("abort", stop);
      resolve(exit);
    };
    if (opts.signal?.aborted) stop();
    else opts.signal?.addEventListener("abort", stop, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        opts.onLine(line);
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });
    child.stdin.on("error", () => {
      // A program that exits without reading its input is not a failure here.
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      done({
        code: null,
        stderr,
        error:
          error.code === "ENOENT"
            ? `\`${command}\` is not installed on this machine, or is not on PATH.`
            : error.message,
      });
    });
    child.on("close", (code) => {
      if (buffer.trim()) opts.onLine(buffer);
      done({ code, stderr });
    });
    child.stdin.end(opts.input);
  });
}

/** One turn through Claude Code or Codex. The same shape as runCommand, so an
 *  interactive session, `run` and `resume` do not care which kind of provider
 *  is behind them. */
export async function runEngineCommand(
  context: CommandContext,
  goal: string,
  options: { resume?: SessionRecord; readOnly?: boolean; quiet?: boolean } = {},
): Promise<RunOutcome> {
  const { terminal } = context;
  const engine = context.provider.name as EngineId;
  const store = new SessionStore(context.root);
  const session =
    options.resume ?? store.create(goal, { provider: engine, model: context.provider.model });
  // The engine keeps the conversation itself. One begun with another provider
  // starts a new conversation there; its history stays in this session.
  const resumeId = session.provider === engine ? session.engineSession : undefined;
  session.goal = goal;
  session.status = "running";
  session.stoppedBecause = "";
  session.provider = engine;
  session.model = context.provider.model;
  store.save(session);

  const streaming = typeof terminal.write === "function";
  const startedAt = Date.now();
  if (!options.quiet && !streaming) {
    terminal.out(`session ${session.id}  ${engine}/${context.provider.model}`);
    terminal.out(`goal: ${goal}`);
  }
  if (!streaming) terminal.out("");

  const live = streaming
    ? new LiveView((text) => terminal.write?.(text), {
        colour: terminal.colour,
        columns: () => terminal.columns || Number(process.env.COLUMNS) || 80,
      })
    : null;
  const stream = new EngineStream(engine, context.root, {
    delta: (text) => live?.delta(text),
    event: (item) => {
      store.appendEvent(session.id, item);
      if (live) {
        live.event(item);
        return;
      }
      const line = renderEvent(item, terminal.colour);
      if (line) terminal.out(line);
    },
  });

  const { command, args } = engineInvocation(engine, {
    model: context.provider.model,
    resume: resumeId,
    plan: Boolean(options.readOnly),
  });
  let totals: EngineTotals;
  try {
    const exit = await spawnEngine(command, args, {
      cwd: context.root,
      input: options.readOnly ? `${PLAN_NOTE}\n\n${goal}` : goal,
      onLine: (line) => stream.feed(line),
      signal: context.signal,
    });
    totals = stream.finish(exit);
  } finally {
    live?.stop();
  }
  if (!totals.ok && context.signal?.aborted) totals.stoppedBecause = "Interrupted.";

  const messages: ProviderMessage[] = [
    ...session.messages,
    { role: "user", content: goal },
    { role: "assistant", content: totals.summary || totals.stoppedBecause },
  ];
  session.engineSession = totals.sessionId ?? resumeId;
  session.status = totals.ok ? "finished" : "stopped";
  session.steps += totals.steps;
  session.filesChanged = [...new Set([...session.filesChanged, ...totals.filesChanged])];
  session.usage = {
    inputTokens: session.usage.inputTokens + totals.usage.inputTokens,
    outputTokens: session.usage.outputTokens + totals.usage.outputTokens,
    cacheReadTokens: session.usage.cacheReadTokens + totals.usage.cacheReadTokens,
    cacheWriteTokens: session.usage.cacheWriteTokens + totals.usage.cacheWriteTokens,
  };
  session.summary = totals.summary;
  session.stoppedBecause = totals.stoppedBecause;
  session.messages = messages;
  store.save(session);

  terminal.out("");
  const elapsed = Date.now() - startedAt;
  if (totals.ok) {
    if (!streaming && totals.summary) terminal.out(totals.summary);
    // No dollar figure: the plan pays, and an API-price estimate would be a
    // number nobody is billed.
    const parts = [`Worked for ${formatElapsed(elapsed)}`];
    if (totals.steps > 0) parts.push(`${totals.steps} step${totals.steps === 1 ? "" : "s"}`);
    if (totals.filesChanged.length > 0) {
      parts.push(
        `${totals.filesChanged.length} file${totals.filesChanged.length === 1 ? "" : "s"} changed`,
      );
    }
    parts.push(`via ${ENGINE_LABEL[engine]}`);
    terminal.out(
      streaming
        ? `${paint("✻", "brand", terminal.colour)} ${paint(parts.join(" · "), "grey", terminal.colour)}`
        : parts.join(", "),
    );
  } else if (streaming) {
    terminal.out(
      renderStopped(elapsed, totals.stoppedBecause, terminal.colour, terminal.columns || 80),
    );
    // The receipt keeps to one line; the full reason, with what to do, too.
    if (totals.stoppedBecause.length > 150 || totals.stoppedBecause.includes("\n")) {
      terminal.err(totals.stoppedBecause);
    }
  } else {
    terminal.err(totals.stoppedBecause);
  }

  const result: RunResult = {
    ok: totals.ok,
    summary: totals.summary,
    steps: totals.steps,
    filesChanged: totals.filesChanged,
    usage: totals.usage,
    costUsd: 0,
    messages,
    stoppedBecause: totals.stoppedBecause,
    handoffs: [],
  };
  return { code: totals.ok ? 0 : 1, session, result };
}

export interface EngineSignIn {
  installed: boolean;
  signedIn: boolean;
  /** Safe to print: never an email address or a token. */
  detail: string;
}

/** Whether the engine's program is installed and signed in, asked of the
 *  program itself. */
export async function engineSignIn(
  engine: EngineId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<EngineSignIn> {
  let out = "";
  const exit = await spawnEngine(
    ENGINE_BINARY[engine],
    engine === "claude-code" ? ["auth", "status"] : ["login", "status"],
    {
      cwd: env.HOME || process.cwd(),
      input: "",
      env,
      timeoutMs: 30_000,
      onLine: (line) => {
        out += `${line}\n`;
      },
    },
  );
  if (exit.error) return { installed: false, signedIn: false, detail: exit.error };

  if (engine === "claude-code") {
    try {
      const status = obj(JSON.parse(out));
      if (status.loggedIn !== true)
        return { installed: true, signedIn: false, detail: "not signed in" };
      const method = str(status.authMethod);
      return {
        installed: true,
        signedIn: true,
        detail:
          method === "claude.ai"
            ? "signed in with a Claude account"
            : `signed in with ${method || "an unknown method"}, which is billed that way rather than to a Claude plan`,
      };
    } catch {
      const text = lastLines(`${out}\n${exit.stderr}`, 1);
      const signedIn = exit.code === 0 && !/not (logged|signed) in/i.test(text);
      return { installed: true, signedIn, detail: signedIn ? "signed in" : "not signed in" };
    }
  }

  const text = lastLines(`${out}\n${exit.stderr}`, 1);
  const signedIn = exit.code === 0 && /logged in/i.test(text) && !/not logged in/i.test(text);
  return {
    installed: true,
    signedIn,
    detail: !signedIn
      ? "not signed in"
      : /chatgpt/i.test(text)
        ? "signed in with a ChatGPT account"
        : "signed in with an API key, which is billed that way rather than to a ChatGPT plan",
  };
}

/** `devstation login claude-code|codex`. Sign-in happens in the engine's own
 *  flow; this only checks it and saves the choice. */
export async function engineLoginCommand(
  context: CommandContext,
  engine: EngineId,
  check: (engine: EngineId) => Promise<EngineSignIn> = engineSignIn,
): Promise<number> {
  const t = context.terminal;
  const label = ENGINE_LABEL[engine];
  const status = await check(engine);
  if (!status.installed) {
    t.err(
      `${label} is not installed here. ${ENGINE_INSTALL[engine]}, sign in with \`${ENGINE_SIGN_IN[engine]}\`, then run \`${CLI_NAME} login ${engine}\` again.`,
    );
    return 1;
  }
  if (!status.signedIn) {
    t.err(
      `${label} is installed but not signed in. Run \`${ENGINE_SIGN_IN[engine]}\` in your shell, which signs in through ${engine === "claude-code" ? "Anthropic" : "OpenAI"} itself, then run \`${CLI_NAME} login ${engine}\` again.`,
    );
    return 1;
  }

  const home = process.env.HOME ?? "";
  if (!home) {
    t.err("HOME is not set, so there is nowhere to store settings.");
    return 2;
  }
  const path = globalConfigPath(home);
  const settings = readSettingsFile(path);
  settings.provider = engine;
  // A model or endpoint saved for an API provider means nothing to this
  // program. It uses its own default until told otherwise.
  delete settings.model;
  delete settings.baseUrl;
  writeSettingsFile(path, settings);

  t.out(
    `Saved. provider ${engine}: each turn runs through ${ENGINE_BINARY[engine]}, ${status.detail}.`,
  );
  t.out("DevStation stores no sign-in for it, and your plan's usage limits apply.");
  t.out(`settings in ${path}`);
  return 0;
}
