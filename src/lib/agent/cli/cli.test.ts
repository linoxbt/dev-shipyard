import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider, resolveSettings } from "../providers";
import { SessionStore } from "../session-store";
import { CLI_NAME, COMMANDS, HELP, SESSION_HELP, parseArgs } from "./args";
import { renderEvent, renderSessions, renderUsage } from "./render";
import { chatCommand, handleSlash } from "./interactive";
import { lineReader } from "./line-reader";
import {
  isAlways,
  approvalKey,
  homeDirectoryWarning,
  configEditCommand,
  loginCommand,
  logoutCommand,
  buildExecutor,
  checkpointsCommand,
  undoCommand,
  configCommand,
  diffCommand,
  doctorCommand,
  runChecks,
  toolsCommand,
  isYes,
  resumeCommand,
  runCommand,
  sessionsCommand,
  statusCommand,
  type CommandContext,
  type Terminal,
} from "./commands";

const dirs: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "cli-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function terminal(answers: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const t: Terminal = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    ask: async (question) => {
      asked.push(question);
      return answers.shift() ?? "";
    },
    colour: false,
  };
  return { t, out, err, asked, text: () => out.join("\n"), errors: () => err.join("\n") };
}

function context(root: string, provider: MockProvider, term: Terminal): CommandContext {
  // The host executor on purpose. These tests are about the CLI, and running
  // each of them in a container turns a three-second suite into a one-minute
  // one and makes it need a Docker daemon that CI does not have. The sandbox
  // has its own tests, which skip cleanly when there is none.
  return { root, terminal: term, provider, maxSteps: 20, sandbox: false };
}

describe("argument parsing", () => {
  it("treats a bare goal as a run", () => {
    const parsed = parseArgs(["fix", "the", "test"], "/tmp");
    expect(parsed.command).toBe("run");
    expect(parsed.rest).toBe("fix the test");
  });

  it("reads the named command and its options", () => {
    const parsed = parseArgs(["run", "do a thing", "--budget", "2.5", "--max-steps", "7", "-y"]);
    expect(parsed.command).toBe("run");
    expect(parsed.maxCostUsd).toBe(2.5);
    expect(parsed.maxSteps).toBe(7);
    expect(parsed.yes).toBe(true);
  });

  it("tells an eight-character id apart from an instruction", () => {
    expect(parseArgs(["resume", "a1b2c3d4", "keep", "going"]).id).toBe("a1b2c3d4");
    expect(parseArgs(["resume", "a1b2c3d4", "keep", "going"]).rest).toBe("keep going");
    expect(parseArgs(["resume", "keep", "going"]).id).toBeUndefined();
  });

  it("refuses an option it does not know instead of ignoring it", () => {
    expect(parseArgs(["run", "x", "--danger"]).error).toContain("--danger");
    expect(parseArgs(["run", "x", "--autonomy", "yolo"]).error).toContain("yolo");
  });

  it("starts a session with no arguments", () => {
    expect(parseArgs([]).command).toBe("chat");
  });

  it("lets --help and --version win over anything else typed", () => {
    expect(parseArgs(["run", "something", "--help"]).command).toBe("help");
    expect(parseArgs(["run", "something", "-v"]).command).toBe("version");
  });

  it("takes a model override and a working directory", () => {
    const parsed = parseArgs(["run", "x", "--model", "claude-opus-5", "-C", "/srv/app"]);
    expect(parsed.model).toBe("claude-opus-5");
    expect(parsed.root).toBe("/srv/app");
    expect(parseArgs(["run", "x", "--model"]).error).toContain("--model");
  });

  it("knows every command it advertises", () => {
    // The help text and the parser drifting apart is the usual way a CLI
    // grows a command nobody can actually type.
    for (const command of COMMANDS) {
      expect(parseArgs([command]).command).toBe(command);
      // chat is what you get by typing nothing, so it has no line of its own.
      if (command !== "chat") expect(HELP).toContain(`${CLI_NAME} ${command}`);
    }
  });
});

describe("approval answers", () => {
  it("counts only a clear yes as yes", () => {
    expect(isYes("y")).toBe(true);
    expect(isYes(" YES ")).toBe(true);
    expect(isYes("")).toBe(false);
    expect(isYes("sure")).toBe(false);
    expect(isYes("n")).toBe(false);
  });
});

describe("rendering", () => {
  it("leaves usage and approval-request events off the transcript", () => {
    const at = new Date().toISOString();
    expect(renderEvent({ kind: "usage", message: "x", at })).toBeNull();
    expect(renderEvent({ kind: "approval.requested", message: "x", at })).toBeNull();
    expect(
      renderEvent({ kind: "step.completed", message: "read a file", at, tool: "read_file" }),
    ).toContain("read a file");
  });

  it("says plainly when nothing changed", () => {
    expect(renderUsage(0.01, 3, [])).toContain("no files changed");
    expect(renderUsage(0.01, 3, ["a.ts"])).toContain("1 file(s) changed");
  });

  it("does not pretend there are sessions when there are none", () => {
    expect(renderSessions([])).toContain("No sessions");
  });
});

describe("run, from the terminal", () => {
  it("does the work and records the session", async () => {
    const root = scratch();
    const provider = new MockProvider([
      {
        toolCalls: [{ id: "1", name: "write_file", input: { path: "hello.txt", content: "hi\n" } }],
      },
      { text: "Wrote hello.txt." },
    ]);
    const term = terminal();
    const { code, session } = await runCommand(context(root, provider, term.t), "write hello.txt");

    expect(code).toBe(0);
    expect(readFileSync(join(root, "hello.txt"), "utf8")).toBe("hi\n");
    expect(term.text()).toContain("Wrote hello.txt.");
    expect(term.text()).toContain("1 file(s) changed");

    const stored = new SessionStore(root).load(session.id);
    expect(stored?.status).toBe("finished");
    expect(stored?.filesChanged).toEqual(["hello.txt"]);
    expect(stored?.messages.length).toBeGreaterThan(2);
  });

  it("asks before a gated action and honours a no", async () => {
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "rm -rf build" } }] },
      { text: "Left it alone." },
    ]);
    const term = terminal(["n"]);
    await runCommand(context(root, provider, term.t), "clean up");

    expect(term.asked[0]).toContain("Allow this?");
    expect(term.text()).toContain("Approval needed");
    expect(term.text()).toContain("was not allowed");
  });

  it("treats an unanswered prompt as a no", async () => {
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "rm -rf build" } }] },
      { text: "ok" },
    ]);
    const term = terminal([]); // the pipe closed; ask() returns ""
    await runCommand(context(root, provider, term.t), "clean up");
    expect(term.text()).toContain("was not allowed");
  });

  it("runs the action when the answer is yes", async () => {
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "mkdir made-it" } }] },
      { text: "done" },
    ]);
    const term = terminal(["y"]);
    await runCommand(context(root, provider, term.t), "make a directory");
    expect(existsSync(join(root, "made-it"))).toBe(true);
  });

  it("skips the question entirely under --yes", async () => {
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "mkdir yes-mode" } }] },
      { text: "done" },
    ]);
    const term = terminal();
    await runCommand({ ...context(root, provider, term.t), yes: true }, "make a directory");
    expect(term.asked).toHaveLength(0);
    expect(existsSync(join(root, "yes-mode"))).toBe(true);
  });

  it("saves a session that can be resumed when the provider throws", async () => {
    const root = scratch();
    // Not the mock: a provider that fails the way a dropped connection does.
    const provider = {
      name: "broken",
      model: "broken",
      generate: () => Promise.reject(new Error("connection reset")),
    } as unknown as MockProvider;
    const term = terminal();
    const { code, session } = await runCommand(context(root, provider, term.t), "do something");

    expect(code).toBe(1);
    expect(term.errors()).toContain(`${CLI_NAME} resume`);
    expect(new SessionStore(root).load(session.id)?.status).toBe("failed");
  });
});

describe("session persistence", () => {
  it("writes after every message, not only at the end", async () => {
    const root = scratch();
    const store = new SessionStore(root);
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.txt", content: "1" } }] },
      { toolCalls: [{ id: "2", name: "write_file", input: { path: "b.txt", content: "2" } }] },
      { text: "done" },
    ]);

    // Each line is paired with what was on disk at the moment it printed. Step
    // lines only print while the run is going, so a step line that sees a
    // non-empty transcript proves the session was saved mid-run rather than
    // only in the final save after the loop returned.
    const seen: { line: string; messages: number }[] = [];
    const term = terminal();
    term.t.out = (line) => seen.push({ line, messages: store.latest()?.messages.length ?? 0 });

    await runCommand(context(root, provider, term.t), "write two files");

    const duringRun = seen.filter((entry) => entry.line.startsWith(">"));
    expect(duringRun.length).toBeGreaterThan(1);
    expect(duringRun.every((entry) => entry.messages > 0)).toBe(true);
  });

  it("keeps its own state out of the repository it is working in", async () => {
    // Found by running the agent on a real repo: without this, the first
    // checkpoint commits .agent/sessions into the user's history, and every
    // turn afterwards looks like it changed a file.
    const root = scratch();
    const { runShell } = await import("../shell");
    await runShell(
      "git init -q && git config user.email a@b.c && git config user.name T && " +
        "echo hi > kept.txt && git add -A && git commit -qm init",
      { cwd: root },
    );

    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "new.txt", content: "x" } }] },
      { text: "done" },
    ]);
    await runCommand(context(root, provider, terminal().t), "add a file");

    const tracked = await runShell("git ls-files", { cwd: root });
    expect(tracked.stdout).toContain("new.txt");
    expect(tracked.stdout).not.toContain(".agent");
  }, 30_000);

  it("survives a truncated write", () => {
    const root = scratch();
    const store = new SessionStore(root);
    const record = store.create("goal", { provider: "mock", model: "mock" });
    Bun.write(join(root, ".agent", "sessions", `${record.id}.json`), "{ not json");
    expect(store.load(record.id)).toBeNull();
    expect(store.list()).toEqual([]);
  });
});

describe("status and sessions", () => {
  it("replays a finished run's log", async () => {
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.txt", content: "1" } }] },
      { text: "wrote a.txt" },
    ]);
    await runCommand(context(root, provider, terminal().t), "write a.txt");

    const term = terminal();
    const code = await statusCommand(context(root, provider, term.t), undefined);
    expect(code).toBe(0);
    expect(term.text()).toContain("write a.txt");
    expect(term.text()).toContain("finished");
    expect(term.text()).toContain("1 file(s) changed");
  });

  it("follows a run that another process is still writing", async () => {
    const root = scratch();
    const store = new SessionStore(root);
    const record = store.create("a long task", { provider: "mock", model: "mock" });
    const at = new Date().toISOString();
    store.appendEvent(record.id, { kind: "step.started", message: "first step", at });

    const term = terminal();
    const watching = statusCommand(context(root, new MockProvider([]), term.t), record.id, {
      follow: true,
      pollMs: 10,
    });

    // The writer keeps going after the watcher attached.
    await new Promise((r) => setTimeout(r, 30));
    store.appendEvent(record.id, { kind: "step.completed", message: "second step", at });
    await new Promise((r) => setTimeout(r, 30));
    record.status = "finished";
    store.save(record);

    await watching;
    expect(term.text()).toContain("first step");
    expect(term.text()).toContain("second step");
  });

  it("does not replay an event twice while following", () => {
    const root = scratch();
    const store = new SessionStore(root);
    const record = store.create("x", { provider: "mock", model: "mock" });
    const at = new Date().toISOString();
    store.appendEvent(record.id, { kind: "plan", message: "one", at });

    const first = store.readEvents(record.id, 0);
    expect(first.events).toHaveLength(1);
    const second = store.readEvents(record.id, first.offset);
    expect(second.events).toHaveLength(0);

    store.appendEvent(record.id, { kind: "plan", message: "two", at });
    const third = store.readEvents(record.id, second.offset);
    expect(third.events.map((e) => e.message)).toEqual(["two"]);
  });

  it("lists sessions newest first", async () => {
    const root = scratch();
    const store = new SessionStore(root);
    const older = store.create("older task", { provider: "mock", model: "mock" });
    await new Promise((r) => setTimeout(r, 5));
    store.create("newer task", { provider: "mock", model: "mock" });

    const term = terminal();
    sessionsCommand(context(root, new MockProvider([]), term.t));
    const lines = term.text().split("\n");
    expect(lines[0]).toContain("newer task");
    expect(lines[1]).toContain(older.id);
  });

  it("says so when there is nothing to show", async () => {
    const root = scratch();
    const term = terminal();
    expect(await statusCommand(context(root, new MockProvider([]), term.t), undefined)).toBe(1);
    expect(term.errors()).toContain("No sessions");
  });
});

describe("resume", () => {
  it("carries the earlier messages back into the model", async () => {
    const root = scratch();
    const first = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.txt", content: "1" } }] },
    ]);
    const { session } = await runCommand(
      { ...context(root, first, terminal().t), maxSteps: 1 },
      "start something",
    );
    expect(session.status).toBe("stopped");

    const second = new MockProvider([{ text: "picked it back up" }]);
    const term = terminal();
    const code = await resumeCommand(context(root, second, term.t), session.id, "finish it");

    expect(code).toBe(0);
    // The resumed call carried the first run's transcript.
    const messages = second.calls[0].messages;
    expect(messages.length).toBeGreaterThan(1);
    expect(messages[0].content).toContain("start something");
    expect(messages.at(-1)?.content).toBe("finish it");
  });

  it("writes its own instruction when given none", async () => {
    const root = scratch();
    const first = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.txt", content: "1" } }] },
    ]);
    const { session } = await runCommand(
      { ...context(root, first, terminal().t), maxSteps: 1 },
      "the original goal",
    );
    const second = new MockProvider([{ text: "ok" }]);
    await resumeCommand(context(root, second, terminal().t), session.id, "");
    expect(second.calls[0].messages.at(-1)?.content).toContain("the original goal");
  });

  it("reports a session id that is not there", async () => {
    const root = scratch();
    const term = terminal();
    expect(await resumeCommand(context(root, new MockProvider([]), term.t), "deadbeef", "go")).toBe(
      1,
    );
    expect(term.errors()).toContain("deadbeef");
  });
});

describe("the rest of the command surface", () => {
  it("lists every tool with what it will do when reached for", () => {
    const root = scratch();
    const term = terminal();
    toolsCommand(context(root, new MockProvider([]), term.t));

    expect(term.text()).toContain("read_file");
    expect(term.text()).toContain("run_shell");
    // The gate column comes from the same policy the run uses.
    expect(term.text()).toMatch(/read_file\s+runs/);
    expect(term.text()).toMatch(/delete_file\s+asks/);
    // The outward tools are a different kind of thing and say so.
    expect(term.text()).toMatch(/push_to_github\s+you do it/);
  });

  it("shows the tools that stop asking under autonomous", () => {
    const root = scratch();
    const strict = terminal();
    const loose = terminal();
    toolsCommand(context(root, new MockProvider([]), strict.t));
    toolsCommand({ ...context(root, new MockProvider([]), loose.t), autonomy: "autonomous" });

    const asksWhenStrict = strict
      .text()
      .split("\n")
      .filter((l) => l.includes("asks")).length;
    const asksWhenLoose = loose
      .text()
      .split("\n")
      .filter((l) => l.includes("asks")).length;
    expect(asksWhenLoose).toBeLessThan(asksWhenStrict);
  });

  it("says plainly when there are no checkpoints, and lists them when there are", async () => {
    const root = scratch();
    const { runShell } = await import("../shell");
    await runShell(
      "git init -q && git config user.email a@b.c && git config user.name T && " +
        "echo hi > a.txt && git add -A && git commit -qm init",
      { cwd: root },
    );

    const empty = terminal();
    await checkpointsCommand(context(root, new MockProvider([]), empty.t));
    expect(empty.text()).toContain("No checkpoints yet");

    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "b.txt", content: "x" } }] },
      { text: "done" },
    ]);
    await runCommand(context(root, provider, terminal().t), "add b.txt");

    const after = terminal();
    await checkpointsCommand(context(root, new MockProvider([]), after.t));
    expect(after.text()).toContain("agent checkpoint:");
  }, 30_000);

  it("diffs the agent's work against the last commit that was not its own", async () => {
    const root = scratch();
    const { runShell } = await import("../shell");
    await runShell(
      "git init -q && git config user.email a@b.c && git config user.name T && " +
        "printf 'one\\n' > a.txt && git add -A && git commit -qm init",
      { cwd: root },
    );

    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.txt", content: "two\n" } }] },
      { text: "done" },
    ]);
    await runCommand(context(root, provider, terminal().t), "change a.txt");

    const term = terminal();
    // The change is inside a checkpoint commit by now, so a plain `git diff`
    // would show nothing at all.
    expect(await diffCommand(context(root, new MockProvider([]), term.t))).toBe(0);
    expect(term.text()).toContain("-one");
    expect(term.text()).toContain("+two");
  }, 30_000);

  it("still lists checkpoints outside a repository, and says why diff cannot", async () => {
    // Both used to refuse. Only diff has a real reason to: a snapshot restores
    // a whole workspace and holds no base to compare against the way a commit
    // does. Checkpoints and undo work here now, so the refusal points at them
    // rather than being a dead end.
    const root = scratch();
    const term = terminal();

    expect(await diffCommand(context(root, new MockProvider([]), term.t))).toBe(1);
    expect(term.errors()).toContain("not a git repository");
    expect(term.errors()).toContain("devstation checkpoints");

    const listing = terminal();
    expect(await checkpointsCommand(context(root, new MockProvider([]), listing.t))).toBe(0);
    expect(listing.text()).toContain("No checkpoints yet");
  });

  it("undoes a run in a workspace with no git at all", async () => {
    // End to end through the CLI's own commands, in a plain folder: run the
    // agent, see it change a file, then take it back. This is the capability
    // that used to be "no, so there are no checkpoints and no undo".
    const root = scratch();
    writeFileSync(join(root, "a.js"), "original\n");
    const term = terminal();

    const provider = new MockProvider([
      {
        toolCalls: [{ id: "1", name: "write_file", input: { path: "a.js", content: "changed\n" } }],
      },
      { text: "Changed it." },
    ]);
    await runCommand(context(root, provider, term.t), "change a.js");
    expect(readFileSync(join(root, "a.js"), "utf8")).toBe("changed\n");

    const undo = terminal();
    expect(await undoCommand(context(root, new MockProvider([]), undo.t))).toBe(0);
    expect(readFileSync(join(root, "a.js"), "utf8")).toBe("original\n");
    expect(existsSync(join(root, ".git"))).toBe(false);
  }, 30_000);

  it("gives a script JSON rather than the same prose", () => {
    // --json was advertised in --help and read by nothing: every command
    // printed its human output and a script parsing it got a surprise. These
    // four are the ones that report rather than act.
    const root = scratch();

    const config = terminal();
    configCommand({
      ...context(root, new MockProvider([]), config.t),
      json: true,
      autonomy: "ask_deploy",
    });
    const parsedConfig = JSON.parse(config.text()) as Record<string, unknown>;
    expect(parsedConfig.workspace).toBe(root);
    expect(parsedConfig.autonomy).toBe("ask_deploy");
    expect(parsedConfig.git).toBe(false);

    const tools = terminal();
    toolsCommand({ ...context(root, new MockProvider([]), tools.t), json: true });
    const parsedTools = JSON.parse(tools.text()) as { tools: { name: string; gate: string }[] };
    expect(parsedTools.tools.length).toBeGreaterThan(5);
    expect(parsedTools.tools.every((t) => typeof t.gate === "string")).toBe(true);

    const sessions = terminal();
    sessionsCommand({ ...context(root, new MockProvider([]), sessions.t), json: true });
    expect(JSON.parse(sessions.text())).toEqual({ sessions: [] });
  });

  it("says which checkpoint mechanism the JSON describes", async () => {
    // A commit and a snapshot are different things, and flattening them into
    // one look-alike record would make a script treat them as interchangeable.
    const root = scratch();
    const term = terminal();
    await checkpointsCommand({ ...context(root, new MockProvider([]), term.t), json: true });
    const parsed = JSON.parse(term.text()) as { kind: string; checkpoints: unknown[] };
    expect(parsed.kind).toBe("snapshot");
    expect(parsed.checkpoints).toEqual([]);
  });

  it("shows the settings a run would actually use", () => {
    const root = scratch();
    const term = terminal();
    configCommand({
      ...context(root, new MockProvider([]), term.t),
      autonomy: "autonomous",
      maxCostUsd: 3,
    });
    expect(term.text()).toContain(root);
    expect(term.text()).toContain("autonomous");
    expect(term.text()).toContain("$3");
    expect(term.text()).toContain("mock/mock-model");
  });

  it("tells the truth about a machine with no key configured", async () => {
    const root = scratch();
    const checks = await runChecks(root, {});
    const provider = checks.find((c) => c.name === "model provider");
    expect(provider?.ok).toBe(false);
    expect(provider?.detail).toContain("ANTHROPIC_API_KEY");
    expect(checks.find((c) => c.name === "workspace")?.detail).toContain("not a git repository");
  }, 30_000);

  it("passes the provider check once a key is present", async () => {
    const checks = await runChecks(scratch(), { ANTHROPIC_API_KEY: "sk-test" });
    expect(checks.find((c) => c.name === "model provider")?.ok).toBe(true);
  }, 30_000);

  it("fails doctor when something needs attention", async () => {
    const root = scratch();
    const term = terminal();
    // No key in this process unless one is set, so this asserts on the shape
    // rather than the verdict.
    const code = await doctorCommand(context(root, new MockProvider([]), term.t));
    expect(term.text()).toContain("git");
    expect(term.text()).toContain("write access");
    expect([0, 1]).toContain(code);
  }, 30_000);
});

describe("a session", () => {
  it("answers slash commands without spending a turn", async () => {
    const root = scratch();
    const provider = new MockProvider([{ text: "should not be reached" }]);
    const term = terminal();
    const ctx = context(root, provider, term.t);

    expect(await handleSlash(ctx, "/help", null)).toBe("handled");
    expect(await handleSlash(ctx, "/tools", null)).toBe("handled");
    expect(await handleSlash(ctx, "/config", null)).toBe("handled");
    expect(await handleSlash(ctx, "/cost", null)).toBe("handled");
    expect(await handleSlash(ctx, "/exit", null)).toBe("exit");
    expect(await handleSlash(ctx, "/clear", null)).toBe("clear");
    expect(await handleSlash(ctx, "fix the bug", null)).toBe("not-a-command");
    expect(provider.calls).toHaveLength(0);
    expect(term.text()).toContain(SESSION_HELP.trim().split("\n")[0].trim());
  });

  it("says so when a slash command does not exist", async () => {
    const root = scratch();
    const term = terminal();
    await handleSlash(context(root, new MockProvider([]), term.t), "/nope", null);
    expect(term.errors()).toContain("/nope");
  });

  it("carries the transcript from one turn to the next", async () => {
    const root = scratch();
    const provider = new MockProvider([{ text: "first answer" }, { text: "second answer" }]);
    const term = terminal(["what is here", "and now this", "/exit"]);
    await chatCommand(context(root, provider, term.t));

    expect(provider.calls).toHaveLength(2);
    // The second turn was given the first turn's exchange, not a blank slate.
    const second = provider.calls[1].messages;
    expect(second.length).toBeGreaterThan(1);
    expect(second[0].content).toContain("what is here");
    expect(second.at(-1)?.content).toBe("and now this");
  });

  it("drops the transcript on /clear but keeps the workspace", async () => {
    const root = scratch();
    const provider = new MockProvider([{ text: "a" }, { text: "b" }]);
    const term = terminal(["first thing", "/clear", "second thing", "/exit"]);
    await chatCommand(context(root, provider, term.t));

    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1].messages).toHaveLength(1);
    expect(provider.calls[1].messages[0].content).toBe("second thing");
  });

  it("takes an opening instruction without waiting to be asked", async () => {
    const root = scratch();
    const provider = new MockProvider([{ text: "done" }]);
    const term = terminal(["/exit"]);
    await chatCommand(context(root, provider, term.t), "start with this");
    expect(provider.calls[0].messages[0].content).toBe("start with this");
  });

  it("ends rather than spinning when its input closes", async () => {
    const root = scratch();
    const term = terminal([]); // every ask() returns ""
    const code = await chatCommand(context(root, new MockProvider([]), term.t));
    expect(code).toBe(0);
  });
});

describe("what config reports", () => {
  it("names the provider a run would use, not the one this command holds", () => {
    // config runs without a provider, so reading it off the context would
    // always claim nothing is configured even when a key is right there.
    const root = scratch();
    const term = terminal();
    configCommand({
      root,
      terminal: term.t,
      provider: null as unknown as MockProvider,
    });
    const line = term
      .text()
      .split("\n")
      .find((l) => l.startsWith("provider"));
    expect(line).toBeDefined();
    // The same resolution a run would do, including where the value came from.
    const expected = resolveSettings({ root });
    expect(line).toContain(expected.provider ?? "none");
    expect(line).toContain(expected.source.provider);
    if (expected.problem) expect(term.errors()).toContain("devstation login");
  });
});

describe("login and config set", () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  function withHome() {
    const home = scratch();
    process.env.HOME = home;
    return home;
  }

  it("stores a key owner-only and never prints it back", async () => {
    const home = withHome();
    const root = scratch();
    const secret = "sk-or-v1-abcdef0123456789";
    // Answers in order: key, model. The provider comes from the argument.
    const term = terminal([secret, "anthropic/claude-sonnet-5"]);
    const code = await loginCommand(context(root, new MockProvider([]), term.t), "openrouter");
    expect(code).toBe(0);

    const stored = JSON.parse(readFileSync(join(home, ".devstation", "credentials.json"), "utf8"));
    expect(stored.openrouter).toBe(secret);
    expect(statSync(join(home, ".devstation", "credentials.json")).mode & 0o777).toBe(0o600);
    // Masked in the confirmation, never whole.
    expect(term.text()).not.toContain(secret);
    expect(term.text()).toContain("sk-o…6789");

    const settings = resolveSettings({ root, home, env: {} });
    expect(settings.provider).toBe("openrouter");
    expect(settings.model).toBe("anthropic/claude-sonnet-5");
    expect(settings.apiKey).toBe(secret);
  });

  it("sets up a local OpenAI-compatible server with no key", async () => {
    const home = withHome();
    const root = scratch();
    // endpoint, key (blank), model
    const term = terminal(["http://localhost:11434/v1", "", "llama3.3"]);
    expect(await loginCommand(context(root, new MockProvider([]), term.t), "openai")).toBe(0);
    const r = resolveSettings({ root, home, env: {} });
    expect(r.provider).toBe("openai");
    expect(r.baseUrl).toBe("http://localhost:11434/v1");
    expect(r.problem).toBeNull();
  });

  it("round-trips a setting, and scopes --project to the workspace", () => {
    const home = withHome();
    const root = scratch();
    const ctx = context(root, new MockProvider([]), terminal().t);

    expect(configEditCommand(ctx, "set model global/model")).toBe(0);
    expect(configEditCommand(ctx, "set model project/model", { project: true })).toBe(0);

    const get = terminal();
    configEditCommand(context(root, new MockProvider([]), get.t), "get model");
    expect(get.text()).toBe("global/model");
    expect(resolveSettings({ root, home, env: { OPENROUTER_API_KEY: "k" } }).model).toBe(
      "project/model",
    );

    expect(configEditCommand(ctx, "unset model", { project: true })).toBe(0);
    expect(resolveSettings({ root, home, env: { OPENROUTER_API_KEY: "k" } }).model).toBe(
      "global/model",
    );
  });

  it("refuses to put a key in a config file", () => {
    withHome();
    const term = terminal();
    expect(
      configEditCommand(context(scratch(), new MockProvider([]), term.t), "set apiKey sk-x"),
    ).toBe(2);
    expect(term.errors()).toContain("devstation login");
  });

  it("rejects an unknown provider and a malformed endpoint", () => {
    withHome();
    const term = terminal();
    const ctx = context(scratch(), new MockProvider([]), term.t);
    expect(configEditCommand(ctx, "set provider gemini")).toBe(2);
    expect(configEditCommand(ctx, "set baseUrl localhost:11434")).toBe(2);
  });

  it("removes one stored key on logout and leaves the rest", async () => {
    const home = withHome();
    const root = scratch();
    await loginCommand(
      context(root, new MockProvider([]), terminal(["sk-ant-111111111", ""]).t),
      "anthropic",
    );
    await loginCommand(
      context(root, new MockProvider([]), terminal(["sk-or-2222222222", ""]).t),
      "openrouter",
    );
    expect(logoutCommand(context(root, new MockProvider([]), terminal().t), "anthropic")).toBe(0);
    const stored = JSON.parse(readFileSync(join(home, ".devstation", "credentials.json"), "utf8"));
    expect(stored.anthropic).toBeUndefined();
    expect(stored.openrouter).toBe("sk-or-2222222222");
  });
});

describe("reading input while a turn is running", () => {
  function fakeInterface() {
    const handlers: Record<string, ((line: string) => void)[]> = {};
    return {
      rl: {
        on(event: string, handler: (line: string) => void) {
          (handlers[event] ??= []).push(handler);
          return this;
        },
        close() {
          for (const h of handlers.close ?? []) h("");
        },
      },
      emit(line: string) {
        for (const h of handlers.line ?? []) h(line);
      },
      end() {
        for (const h of handlers.close ?? []) h("");
      },
    };
  }

  it("keeps lines that arrive while nobody is asking", async () => {
    // The bug this replaced: a piped session read its first instruction, spent
    // a minute on it, and the rest of the input was gone by the time it asked.
    const fake = fakeInterface();
    const reader = lineReader(fake.rl as never, () => {});
    fake.emit("first");
    fake.emit("second");
    expect(await reader.ask("> ")).toBe("first");
    expect(await reader.ask("> ")).toBe("second");
  });

  it("still drains what it queued after the input ends", async () => {
    const fake = fakeInterface();
    const reader = lineReader(fake.rl as never, () => {});
    fake.emit("only line");
    fake.end();
    expect(await reader.ask("> ")).toBe("only line");
    expect(await reader.ask("> ")).toBe("");
  });

  it("releases a waiting prompt when the input closes", async () => {
    const fake = fakeInterface();
    const reader = lineReader(fake.rl as never, () => {});
    const pending = reader.ask("> ");
    fake.end();
    expect(await pending).toBe("");
  });

  it("only writes the prompt when it actually has to wait", async () => {
    const written: string[] = [];
    const fake = fakeInterface();
    const reader = lineReader(fake.rl as never, (t) => written.push(t));
    fake.emit("queued");
    await reader.ask("> ");
    expect(written).toHaveLength(0);
    void reader.ask("> ");
    expect(written).toEqual(["> "]);
  });
});

describe("choosing where commands run", () => {
  it("defaults to the sandbox, so the weaker mode is always a choice", () => {
    expect(parseArgs(["run", "x"]).sandbox).toBe(true);
    expect(parseArgs(["run", "x", "--no-sandbox"]).sandbox).toBe(false);
    expect(parseArgs(["run", "x", "--sandbox"]).sandbox).toBe(true);
  });

  it("uses the host executor when asked to", async () => {
    const built = await buildExecutor(scratch(), false);
    expect("executor" in built).toBe(true);
    if (!("executor" in built)) return;
    expect(built.executor.kind).toBe("host");
    expect(built.executor.describe).toContain("unsandboxed");
  });

  it("says where commands ran in the run header", async () => {
    const root = scratch();
    const provider = new MockProvider([{ text: "done" }]);
    const term = terminal();
    await runCommand(context(root, provider, term.t), "nothing much");
    expect(term.text()).toContain("commands run on this machine, unsandboxed");
  });

  it("refuses rather than silently dropping to the host", async () => {
    // The whole point of the default. A run that cannot be sandboxed stops and
    // says so, because somebody who thinks they are protected and is not is
    // worse off than somebody who knows they are not.
    const root = scratch();
    const provider = new MockProvider([{ text: "should not get here" }]);
    const term = terminal();
    const { code } = await runCommand(
      { ...context(root, provider, term.t), sandbox: true },
      "do something",
      {},
    );

    // On a machine with Docker and the image this succeeds; on one without, it
    // refuses. Either is correct; silently running on the host is not.
    if (code === 2) {
      expect(term.errors()).toMatch(/--no-sandbox/);
      expect(provider.calls).toHaveLength(0);
    } else {
      expect(term.text()).toContain("commands run in a");
    }
  }, 120_000);
});

describe("what doctor reports", () => {
  it("covers the sandbox without needing it", async () => {
    // This is the command people run when the agent will not start, so it has
    // to work on the machine where the sandbox cannot.
    const checks = await runChecks(scratch(), {});
    const names = checks.map((c) => c.name);
    expect(names).toContain("docker");
    expect(names).toContain("isolation");
    expect(names).toContain("sandbox image");
  }, 120_000);
});

describe("forgiving input", () => {
  const realHome = process.env.HOME;
  afterEach(() => {
    process.env.HOME = realHome;
  });

  it("accepts a provider name in any capitalisation", async () => {
    // Typing "OpenAI" was refused with "Unknown provider", which is the kind of
    // papercut that makes a first run feel broken.
    const home = scratch();
    process.env.HOME = home;
    const root = scratch();
    const setTerm = terminal();
    expect(
      configEditCommand(context(root, new MockProvider([]), setTerm.t), "set provider OpenRouter"),
    ).toBe(0);
    expect(resolveSettings({ root, home, env: {} }).provider).toBe("openrouter");

    const login = terminal(["http://localhost:11434/v1", "", "llama3.3"]);
    expect(await loginCommand(context(root, new MockProvider([]), login.t), "OpenAI")).toBe(0);
    expect(resolveSettings({ root, home, env: {} }).provider).toBe("openai");
  });

  it("warns when started in a home directory, and not elsewhere", () => {
    expect(homeDirectoryWarning("/root", "/root")).toContain("home directory");
    expect(homeDirectoryWarning("/root/", "/root")).toContain("home directory");
    expect(homeDirectoryWarning("/root/project", "/root")).toBeNull();
    expect(homeDirectoryWarning("/root", "")).toBeNull();
  });
});

describe("always allowing an action for the session", () => {
  it("accepts a and always", () => {
    expect(isAlways("a")).toBe(true);
    expect(isAlways("Always")).toBe(true);
    expect(isAlways("y")).toBe(false);
    expect(isAlways("")).toBe(false);
  });

  it("remembers the action and what it touches, not the whole operation", () => {
    // Saying always to one command must not approve every other write.
    const ls = {
      tool: "run_shell",
      operation: "shell.write",
      resources: ["sh:ls"],
      riskLevel: "high",
      why: "",
    };
    const npm = { ...ls, resources: ["sh:npm"] };
    expect(approvalKey(ls)).not.toBe(approvalKey(npm));
  });
});
