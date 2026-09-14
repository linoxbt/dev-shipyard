import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent } from "../orchestrator";
import {
  EngineProvider,
  isEngineProvider,
  providerFromSettings,
  readSettingsFile,
  resolveSettings,
} from "../providers";
import { SessionStore } from "../session-store";
import type { CommandContext, Terminal } from "./commands";
import { runCommand } from "./commands";
import {
  EngineStream,
  claudeToolCall,
  codexCommand,
  engineInvocation,
  engineLoginCommand,
} from "./engine-run";
import { LiveView } from "./live";

// Claude Code and Codex as engines: a turn is handed to the program the person
// signed in to with their own Claude or ChatGPT plan, and its JSON stream is
// drawn as DevStation draws its own turns. The stream lines below have the
// shapes those programs printed in real runs.

const dirs: string[] = [];
const restore: Array<() => void> = [];
afterEach(() => {
  for (const undo of restore.splice(0)) undo();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "engine-"));
  dirs.push(dir);
  return dir;
}

function setEnv(name: string, value: string) {
  const before = process.env[name];
  process.env[name] = value;
  restore.push(() => {
    if (before === undefined) delete process.env[name];
    else process.env[name] = before;
  });
}

function collect() {
  const deltas: string[] = [];
  const events: AgentEvent[] = [];
  return {
    deltas,
    events,
    sink: { delta: (t: string) => deltas.push(t), event: (e: AgentEvent) => events.push(e) },
  };
}

const ROOT = "/work/app";

function claudeLines(sessionId = "sess-1"): string[] {
  const s = { session_id: sessionId, parent_tool_use_id: null };
  return [
    { type: "system", subtype: "init", cwd: ROOT, session_id: sessionId, tools: ["Bash"] },
    { type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } }, ...s },
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Listing " },
      },
      ...s,
    },
    {
      type: "stream_event",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "first.\n" },
      },
      ...s,
    },
    {
      type: "stream_event",
      event: {
        type: "message_delta",
        delta: { stop_reason: "tool_use" },
        usage: { output_tokens: 148 },
      },
      ...s,
    },
    { type: "stream_event", event: { type: "message_stop" }, ...s },
    {
      type: "assistant",
      message: {
        id: "msg_1",
        content: [
          { type: "text", text: "Listing first.\n" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Bash",
            input: { command: "ls", description: "List files" },
          },
        ],
      },
      ...s,
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { tool_use_id: "toolu_1", type: "tool_result", content: "notes.txt", is_error: false },
        ],
      },
      ...s,
    },
    {
      type: "assistant",
      message: {
        id: "msg_2",
        content: [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "Write",
            input: { file_path: `${ROOT}/hello.txt`, content: "hi\n" },
          },
        ],
      },
      ...s,
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { tool_use_id: "toolu_2", type: "tool_result", content: "File created", is_error: false },
        ],
      },
      ...s,
    },
    {
      type: "assistant",
      message: {
        id: "msg_3",
        content: [
          {
            type: "tool_use",
            id: "toolu_sub",
            name: "Bash",
            input: { command: "echo from a subagent" },
          },
        ],
      },
      session_id: sessionId,
      parent_tool_use_id: "toolu_task",
    },
    {
      type: "assistant",
      message: {
        id: "msg_4",
        content: [
          { type: "tool_use", id: "toolu_3", name: "Bash", input: { command: "npm test" } },
        ],
      },
      ...s,
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { tool_use_id: "toolu_3", type: "tool_result", content: "1 failing", is_error: true },
        ],
      },
      ...s,
    },
    {
      type: "system",
      subtype: "permission_denied",
      tool_name: "Bash",
      message: "rm is not allowed here",
      session_id: sessionId,
    },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "done",
      session_id: sessionId,
      total_cost_usd: 0.26,
      usage: {
        input_tokens: 66,
        output_tokens: 665,
        cache_read_input_tokens: 61489,
        cache_creation_input_tokens: 21223,
      },
    },
  ].map((line) => JSON.stringify(line));
}

const CODEX_LINES = [
  { type: "thread.started", thread_id: "01a09ee6-2e42-77a0-bbdd-2c13d19c3f1d" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "item_0", type: "agent_message", text: "I’ll run `ls`." } },
  {
    type: "item.started",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "/bin/bash -lc ls",
      aggregated_output: "",
      exit_code: null,
      status: "in_progress",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "item_1",
      type: "command_execution",
      command: "/bin/bash -lc ls",
      aggregated_output: "notes.txt\n",
      exit_code: 0,
      status: "completed",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "item_2",
      type: "command_execution",
      command: "/bin/bash -lc 'npm test'",
      aggregated_output: "1 failing\n",
      exit_code: 1,
      status: "failed",
    },
  },
  {
    type: "item.completed",
    item: {
      id: "item_4",
      type: "file_change",
      changes: [
        { path: `${ROOT}/new.txt`, kind: "add" },
        { path: `${ROOT}/notes.txt`, kind: "update" },
      ],
      status: "completed",
    },
  },
  { type: "item.completed", item: { id: "item_5", type: "agent_message", text: "done" } },
  {
    type: "turn.completed",
    usage: { input_tokens: 35795, cached_input_tokens: 29824, output_tokens: 102 },
  },
].map((line) => JSON.stringify(line));

describe("reading Claude Code's stream", () => {
  it("streams the text once, and turns each tool call into a step with its result", () => {
    const { deltas, events, sink } = collect();
    const stream = new EngineStream("claude-code", ROOT, sink);
    for (const line of claudeLines()) stream.feed(line);
    const totals = stream.finish({ code: 0, stderr: "" });

    // The same text also comes whole in the assistant message; it is not printed twice.
    expect(deltas.join("")).toBe("Listing first.\n");
    const steps = events.filter((e) => e.kind.startsWith("step."));
    expect(steps.map((e) => `${e.kind} ${e.tool}`)).toEqual([
      "step.started run_shell",
      "step.completed run_shell",
      "step.started write_file",
      "step.completed write_file",
      "step.started run_shell",
      "step.failed run_shell",
    ]);
    expect(steps[1].detail).toMatchObject({
      input: { command: "ls" },
      output: "exit 0\nnotes.txt",
    });
    expect(steps[3].detail).toMatchObject({ input: { path: "hello.txt", lines: 2 } });
    expect(steps[5].detail).toMatchObject({ output: "exit 1\n1 failing" });
    // A subagent's own steps are not drawn as this turn's.
    expect(JSON.stringify(events)).not.toContain("from a subagent");
    expect(events.some((e) => e.kind === "usage" && e.message.startsWith("148 "))).toBe(true);
    expect(events.some((e) => e.kind === "plan" && e.message.includes("rm is not allowed"))).toBe(
      true,
    );

    expect(totals).toMatchObject({
      ok: true,
      sessionId: "sess-1",
      summary: "done",
      steps: 3,
      filesChanged: ["hello.txt"],
      usage: {
        inputTokens: 66,
        outputTokens: 665,
        cacheReadTokens: 61489,
        cacheWriteTokens: 21223,
      },
    });
  });

  it("says why a turn failed, and how to sign in when that is the reason", () => {
    const { sink } = collect();
    const stream = new EngineStream("claude-code", ROOT, sink);
    stream.feed(
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Not logged in · Please run /login",
      }),
    );
    const totals = stream.finish({ code: 1, stderr: "" });
    expect(totals.ok).toBe(false);
    expect(totals.stoppedBecause).toContain("Not logged in");
    expect(totals.stoppedBecause).toContain("claude auth login");
    // The error is why it stopped, not a summary of work done.
    expect(totals.summary).toBe("");
  });

  it("draws Claude Code's tools as DevStation's cells", () => {
    const chunks: string[] = [];
    const live = new LiveView((t) => chunks.push(t), { colour: false, tickMs: 0, verb: "Working" });
    const stream = new EngineStream("claude-code", ROOT, {
      delta: (t) => live.delta(t),
      event: (e) => live.event(e),
    });
    for (const line of claudeLines()) stream.feed(line);
    live.stop();
    const screen = chunks.join("");
    expect(screen).toContain("● Listing first.");
    expect(screen).toContain("● Bash(ls)");
    expect(screen).toContain("⎿  notes.txt");
    expect(screen).toContain("● Write(hello.txt)");
    expect(screen).toContain("● Bash(npm test)");

    expect(claudeToolCall("Edit", { file_path: `${ROOT}/src/a.ts` }, ROOT)).toMatchObject({
      tool: "edit_file",
      input: { path: "src/a.ts" },
      changes: "src/a.ts",
    });
    expect(
      claudeToolCall(
        "TodoWrite",
        { todos: [{ content: "Write tests", status: "in_progress" }] },
        ROOT,
      ).input,
    ).toEqual({ plan: [{ step: "Write tests", status: "in_progress" }] });
    expect(claudeToolCall("Task", { description: "Explore the repo" }, ROOT).tool).toBe(
      "Agent(Explore the repo)",
    );
  });
});

describe("reading Codex's stream", () => {
  it("shows messages, commands and file changes, and keeps the thread for resuming", () => {
    const { deltas, events, sink } = collect();
    const stream = new EngineStream("codex", ROOT, sink);
    for (const line of CODEX_LINES) stream.feed(line);
    stream.feed("Reading additional input from stdin...");
    const totals = stream.finish({ code: 0, stderr: "" });

    expect(deltas).toEqual(["I’ll run `ls`.\n", "done\n"]);
    const steps = events.filter((e) => e.kind.startsWith("step."));
    expect(steps.map((e) => `${e.kind} ${e.tool}`)).toEqual([
      "step.started run_shell",
      "step.completed run_shell",
      "step.failed run_shell",
      "step.completed write_file",
      "step.completed edit_file",
    ]);
    expect(steps[1].detail).toMatchObject({
      input: { command: "ls" },
      output: "exit 0\nnotes.txt\n",
    });
    expect(steps[2].detail).toMatchObject({ input: { command: "npm test" } });
    expect(totals).toMatchObject({
      ok: true,
      sessionId: "01a09ee6-2e42-77a0-bbdd-2c13d19c3f1d",
      summary: "done",
      steps: 4,
      filesChanged: ["new.txt", "notes.txt"],
      usage: { inputTokens: 35795 - 29824, cacheReadTokens: 29824, outputTokens: 102 },
    });
  });

  it("reports a failed turn, or an exit with no turn at all", () => {
    const failed = new EngineStream("codex", ROOT, collect().sink);
    failed.feed(JSON.stringify({ type: "turn.failed", error: { message: "401 Unauthorized" } }));
    expect(failed.finish({ code: 1, stderr: "" }).stoppedBecause).toContain("codex login");

    // The API's JSON error arrives inside the message; only its sentence is shown.
    const refused = new EngineStream("codex", ROOT, collect().sink);
    refused.feed(
      JSON.stringify({
        type: "error",
        message: JSON.stringify({
          type: "error",
          status: 400,
          error: {
            type: "invalid_request_error",
            message: "The 'x/y' model is not supported when using Codex with a ChatGPT account.",
          },
        }),
      }),
    );
    expect(refused.finish({ code: 1, stderr: "" }).stoppedBecause).toBe(
      "The 'x/y' model is not supported when using Codex with a ChatGPT account.",
    );

    const died = new EngineStream("codex", ROOT, collect().sink);
    expect(died.finish({ code: 2, stderr: "[31merror: bad config[0m\n" })).toMatchObject({
      ok: false,
      stoppedBecause: "error: bad config",
    });
  });

  it("unwraps the shell Codex runs commands through", () => {
    expect(codexCommand("/bin/bash -lc ls")).toBe("ls");
    expect(codexCommand("bash -lc 'npm run build && npm test'")).toBe("npm run build && npm test");
    expect(codexCommand(`/bin/zsh -lc 'echo '\\''hi'\\'''`)).toBe("echo 'hi'");
    expect(codexCommand("git status")).toBe("git status");
  });
});

describe("the command line for a turn", () => {
  it("runs Claude Code unattended in auto mode, in plan mode when planning, resuming its session", () => {
    const fresh = engineInvocation("claude-code", { plan: false });
    expect(fresh.command).toBe("claude");
    expect(fresh.args).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      "auto",
    ]);
    const next = engineInvocation("claude-code", { plan: true, model: "sonnet", resume: "sess-1" });
    expect(next.args.join(" ")).toContain("--permission-mode plan --model sonnet --resume sess-1");
    expect(engineInvocation("claude-code", { plan: false, model: "default" }).args).not.toContain(
      "--model",
    );
  });

  it("runs Codex writing inside the project, read-only when planning, resuming its thread", () => {
    const fresh = engineInvocation("codex", { plan: false });
    expect(fresh.command).toBe("codex");
    expect(fresh.args).toEqual([
      "exec",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="workspace-write"',
      "-c",
      "sandbox_workspace_write.network_access=true",
      "-",
    ]);
    const next = engineInvocation("codex", { plan: true, resume: "thread-9", model: "gpt-5.5" });
    expect(next.args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(next.args).toContain('sandbox_mode="read-only"');
    expect(next.args.slice(-2)).toEqual(["thread-9", "-"]);
    expect(next.args.join(" ")).toContain("-m gpt-5.5");
  });
});

describe("choosing an engine", () => {
  it("needs no key, and builds a provider the orchestrator is never given", () => {
    const root = scratch();
    mkdirSync(join(root, ".devstation"), { recursive: true });
    writeFileSync(join(root, ".devstation", "config.json"), JSON.stringify({ provider: "codex" }));
    const resolved = resolveSettings({ root, home: "", env: {} });
    expect(resolved.problem).toBeNull();
    const provider = providerFromSettings(resolved);
    expect(isEngineProvider(provider)).toBe(true);
    expect(provider).toMatchObject({ name: "codex", model: "default" });
  });

  it("leaves out a model saved for an API provider, which neither program accepts", () => {
    const root = scratch();
    const home = scratch();
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(
      join(home, ".devstation", "config.json"),
      JSON.stringify({ provider: "openrouter", model: "anthropic/claude-opus-5" }),
    );
    const env = { DEVSTATION_PROVIDER: "claude-code" };
    const resolved = resolveSettings({ root, home, env });
    expect(resolved.model).toBeNull();
    expect(resolved.warnings).toEqual([]);
    expect(providerFromSettings(resolved)).toMatchObject({ name: "claude-code", model: "default" });

    // A name the program knows passes through.
    expect(resolveSettings({ root, home, env, model: "sonnet" }).model).toBe("sonnet");
  });

  it("saves the choice only once the engine's own program says it is signed in", async () => {
    const home = scratch();
    setEnv("HOME", home);
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(
      join(home, ".devstation", "config.json"),
      JSON.stringify({ provider: "openrouter", model: "anthropic/claude-opus-5" }),
    );
    const out: string[] = [];
    const err: string[] = [];
    const context = {
      root: home,
      terminal: {
        out: (t: string) => out.push(t),
        err: (t: string) => err.push(t),
        ask: async () => "",
        colour: false,
      },
    } as unknown as CommandContext;

    expect(
      await engineLoginCommand(context, "claude-code", async () => ({
        installed: true,
        signedIn: false,
        detail: "not signed in",
      })),
    ).toBe(1);
    expect(err.join(" ")).toContain("claude auth login");
    expect(readSettingsFile(join(home, ".devstation", "config.json")).provider).toBe("openrouter");

    expect(
      await engineLoginCommand(context, "claude-code", async () => ({
        installed: true,
        signedIn: true,
        detail: "signed in with a Claude account",
      })),
    ).toBe(0);
    const saved = readSettingsFile(join(home, ".devstation", "config.json"));
    expect(saved.provider).toBe("claude-code");
    // An API model name would mean nothing to claude.
    expect(saved.model).toBeUndefined();
    expect(out.join("\n")).toContain("signed in with a Claude account");
  });
});

describe("a turn through an engine", () => {
  function fakeClaude(lines: string[]): { bin: string; dir: string } {
    const dir = scratch();
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(dir, "stream.jsonl"), `${lines.join("\n")}\n`);
    const script = join(bin, "claude");
    writeFileSync(
      script,
      `#!/bin/sh\ncat > "${dir}/prompt.txt"\nprintf '%s\\n' "$@" > "${dir}/args.txt"\ncat "${dir}/stream.jsonl"\n`,
    );
    chmodSync(script, 0o755);
    return { bin, dir };
  }

  function terminal(): Terminal & { lines: string[]; errors: string[] } {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
      lines,
      errors,
      out: (t) => lines.push(t),
      err: (t) => errors.push(t),
      ask: async () => "",
      colour: false,
    };
  }

  it("hands the prompt to claude, saves its session, and resumes it on the next turn", async () => {
    const fake = fakeClaude(claudeLines("sess-42"));
    setEnv("PATH", `${fake.bin}:${process.env.PATH ?? ""}`);
    const root = scratch();
    const term = terminal();
    const context: CommandContext = {
      root,
      terminal: term,
      provider: new EngineProvider("claude-code"),
    };

    const first = await runCommand(context, "build a tip jar");
    expect(first.code).toBe(0);
    expect(readFileSync(join(fake.dir, "prompt.txt"), "utf8")).toBe("build a tip jar");
    expect(readFileSync(join(fake.dir, "args.txt"), "utf8")).not.toContain("--resume");
    expect(first.session.engineSession).toBe("sess-42");
    expect(first.result?.costUsd).toBe(0);
    expect(term.lines.join("\n")).toContain("done");
    expect(term.lines.join("\n")).toContain("via Claude Code");

    const second = await runCommand(context, "now add tests", {
      resume: first.session,
      readOnly: true,
    });
    expect(second.code).toBe(0);
    const args = readFileSync(join(fake.dir, "args.txt"), "utf8").split("\n");
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe("sess-42");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("plan");
    expect(readFileSync(join(fake.dir, "prompt.txt"), "utf8")).toContain("now add tests");

    const stored = new SessionStore(root).load(first.session.id);
    expect(stored?.provider).toBe("claude-code");
    expect(stored?.steps).toBe(6);
    expect(stored?.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("says how to install and sign in when the program is not there", async () => {
    setEnv("PATH", scratch());
    const term = terminal();
    const outcome = await runCommand(
      { root: scratch(), terminal: term, provider: new EngineProvider("codex") },
      "hello",
    );
    expect(outcome.code).toBe(1);
    const said = term.errors.join("\n");
    expect(said).toContain("`codex` is not installed");
    expect(said).toContain("npm install -g @openai/codex");
    expect(said).toContain("codex login");
  });
});
