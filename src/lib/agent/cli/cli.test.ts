import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../providers";
import { SessionStore } from "../session-store";
import { parseArgs } from "./args";
import { renderEvent, renderSessions, renderUsage } from "./render";
import {
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
  return { root, terminal: term, provider, maxSteps: 20 };
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

  it("defaults to help with no arguments", () => {
    expect(parseArgs([]).command).toBe("help");
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
    expect(term.errors()).toContain("agent resume");
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
