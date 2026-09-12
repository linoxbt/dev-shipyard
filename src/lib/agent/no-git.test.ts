import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "./providers";
import { Orchestrator, type AgentEvent } from "./orchestrator";
import { Workspace } from "./workspace";
import { CODING_AGENT_SYSTEM, GIT_ADDENDUM } from "./system-prompt";
import { hasSnapshots } from "./snapshots";

// The agent must be exactly as capable pointed at an empty folder as it is
// pointed at a mature repository.
//
// This is an easy property to lose by accident rather than by decision. Every
// feature that arrives later -- checkpoints, undo, session resume, diffing --
// has a natural git-shaped implementation, and if nobody is checking, the
// day comes when the loop quietly needs a repository to work at all. These
// tests are here to fail on that day.
//
// Written as end-to-end runs through the real orchestrator rather than as unit
// tests of isRepo(), because the assumption this guards against would not live
// in one function. It would live in the joins between them.

const dirs: string[] = [];
function emptyDir(prefix = "nogit-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Nothing anywhere under here is a git repository. Checked rather than
 *  assumed, because a stray `git init` is exactly the regression these tests
 *  exist to catch, and it would otherwise be invisible. */
function containsGit(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git") return true;
    if (entry.isDirectory() && containsGit(join(dir, entry.name))) return true;
  }
  return false;
}

const TEST_SCRIPT = 'node -e "process.exit(0)"';

describe("the whole loop in a directory with no git repository", () => {
  it("builds a project from nothing, runs its tests, and finishes", async () => {
    // A completely empty directory. No package.json, no source, no .git, no
    // remote, nothing to read and nothing to infer from.
    const root = emptyDir();
    expect(readdirSync(root)).toEqual([]);

    const provider = new MockProvider([
      {
        text: "Starting from an empty directory.",
        toolCalls: [
          {
            id: "1",
            name: "write_file",
            input: {
              path: "package.json",
              content: `{ "name": "from-nothing", "version": "1.0.0", "scripts": { "test": ${JSON.stringify(TEST_SCRIPT)} } }\n`,
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "2",
            name: "write_file",
            input: { path: "src/index.js", content: "export const answer = 42;\n" },
          },
        ],
      },
      { toolCalls: [{ id: "3", name: "run_tests", input: {} }] },
      { text: "Created the project and its tests pass." },
    ]);

    const events: AgentEvent[] = [];
    const result = await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      onEvent: (event) => events.push(event),
    }).run("Start a project here");

    expect(result.stoppedBecause).toBe("finished");
    expect(existsSync(join(root, "package.json"))).toBe(true);
    expect(existsSync(join(root, "src/index.js"))).toBe(true);

    // Every step worked. A failure here would mean some part of the loop needs
    // a repository to do its job.
    const failures = events.filter((e) => e.kind === "step.failed");
    expect(failures.map((f) => `${f.tool}: ${f.message}`)).toEqual([]);

    // The tests really ran, rather than being skipped for want of a manifest.
    const tests = events.find((e) => e.kind === "step.completed" && e.tool === "run_tests");
    expect(tests).toBeDefined();

    // Checkpointed, and by the path that does not need git. Undo is not a
    // capability only version-controlled projects are allowed to have: this
    // used to assert the opposite, which was the limitation rather than the
    // behaviour.
    expect(events.some((e) => e.kind === "checkpoint")).toBe(true);
    expect(hasSnapshots(root)).toBe(true);
    expect(events.some((e) => e.kind === "task.completed")).toBe(true);

    // And the agent did not make the directory into a repository to suit
    // itself. Version control is the user's decision.
    expect(containsGit(root)).toBe(false);
  }, 60_000);

  it("is not told it is in a repository when it is not", async () => {
    const root = emptyDir();
    const provider = new MockProvider([{ text: "Nothing to do." }]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("hello");

    const system = provider.calls[0].system;
    expect(system).toContain(CODING_AGENT_SYSTEM);
    expect(system).not.toContain(GIT_ADDENDUM);
    // The wording matters as much as the addendum. "The codebase" and "the
    // repo" both tell the model something is already there.
    expect(system.toLowerCase()).not.toContain("codebase");
    expect(system.toLowerCase()).not.toContain("repository");
  });

  it("edits plain unversioned files someone copied in", async () => {
    // Case two: files, but no .git. The most common shape of a folder that has
    // never been under version control.
    const root = emptyDir();
    writeFileSync(join(root, "main.py"), "def add(a, b):\n    return a - b\n");

    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "edit_file",
            input: {
              path: "main.py",
              patch: "@@ -1,2 +1,2 @@\n def add(a, b):\n-    return a - b\n+    return a + b\n",
            },
          },
        ],
      },
      { text: "Fixed the sign." },
    ]);

    const workspace = new Workspace(root);
    const result = await new Orchestrator({ provider, workspace }).run("add is subtracting");

    expect(result.stoppedBecause).toBe("finished");
    const read = workspace.read("main.py");
    expect(read.ok && read.content).toContain("return a + b");
    expect(containsGit(root)).toBe(false);
  }, 30_000);

  it("answers a git request with git's own refusal rather than breaking the run", async () => {
    // The model may still reach for git in a folder that has none. What it
    // must not do is take the loop down with it: the turn continues and the
    // model is told what happened, the same as any other failed tool call.
    const root = emptyDir();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "git", input: { op: "status" } }] },
      { text: "There is no repository here, so I left version control alone." },
    ]);

    const result = await new Orchestrator({ provider, workspace: new Workspace(root) }).run("go");

    expect(result.stoppedBecause).toBe("finished");
    const told = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(told.content.toLowerCase()).toContain("not a git repository");
  }, 30_000);

  it("reports honestly when there is no manifest it recognises", async () => {
    // Case six: an ecosystem with no dedicated support. The generic tools still
    // work; the specialised ones say so plainly instead of failing obscurely.
    const root = emptyDir();
    writeFileSync(join(root, "main.rb"), "puts 'hello'\n");

    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "read_file", input: { path: "main.rb" } }] },
      { toolCalls: [{ id: "2", name: "run_tests", input: {} }] },
      { text: "I read the file. There is no test runner I recognise here." },
    ]);

    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("run the tests");

    const messages = provider.calls[2].messages.filter((m) => m.role === "tool") as {
      content: string;
    }[];
    expect(messages[0].content).toContain("hello");
    expect(messages[1].content).toContain("no package manifest");
  }, 30_000);
});
