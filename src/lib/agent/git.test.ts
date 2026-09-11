import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "./shell";
import {
  CHECKPOINT_PREFIX,
  changedFiles,
  checkpoint,
  headIsCheckpoint,
  agentDiff,
  agentStatus,
  isRepo,
  listCheckpoints,
  undoCheckpoint,
} from "./git";

const dirs: string[] = [];
async function repo(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "git-"));
  dirs.push(root);
  await runShell("git init -q && git config user.email a@b.c && git config user.name T", {
    cwd: root,
  });
  writeFileSync(join(root, "README.md"), "start\n");
  await runShell("git add -A && git commit -qm initial", { cwd: root });
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("checkpoints", () => {
  it("commits what changed, tagged as the agent's", async () => {
    const root = await repo();
    writeFileSync(join(root, "app.js"), "const x = 1;\n");

    const result = await checkpoint(root, "add app.js");
    expect(result.ok).toBe(true);
    expect(result.sha).not.toBeNull();
    expect(result.message).toStartWith(CHECKPOINT_PREFIX);
    expect(await changedFiles(root)).toEqual([]);
  }, 30_000);

  it("treats nothing-to-commit as success, not failure", async () => {
    // A turn that verified cleanly without touching a file is ordinary, and
    // should not read as an error in the log.
    const root = await repo();
    const result = await checkpoint(root, "no changes");
    expect(result.ok).toBe(true);
    expect(result.sha).toBeNull();
  }, 30_000);

  it("says so when the workspace is not a repository", async () => {
    const plain = mkdtempSync(join(tmpdir(), "plain-"));
    dirs.push(plain);
    expect(isRepo(plain)).toBe(false);
    expect((await checkpoint(plain, "x")).ok).toBe(false);
  }, 30_000);

  it("does not write agent identity into the repo's own config", async () => {
    // Checkpointing must not mutate the user's git settings.
    const root = await repo();
    writeFileSync(join(root, "a.js"), "1\n");
    await checkpoint(root, "x");
    const name = await runShell("git config user.name", { cwd: root });
    expect(name.stdout.trim()).toBe("T");
  }, 30_000);
});

describe("undo", () => {
  it("rewinds the agent's own checkpoint and restores the file", async () => {
    const root = await repo();
    writeFileSync(join(root, "app.js"), "const x = 1;\n");
    await checkpoint(root, "add app.js");
    expect(existsSync(join(root, "app.js"))).toBe(true);

    const undone = await undoCheckpoint(root);
    expect(undone.ok).toBe(true);
    expect(existsSync(join(root, "app.js"))).toBe(false);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("start\n");
  }, 30_000);

  it("REFUSES when someone else committed on top", async () => {
    // The important one. A blind reset --hard HEAD~1 would throw away their
    // commit instead of the agent's, with no warning.
    const root = await repo();
    writeFileSync(join(root, "app.js"), "const x = 1;\n");
    await checkpoint(root, "add app.js");

    writeFileSync(join(root, "mine.js"), "// my work\n");
    await runShell("git add -A && git commit -qm 'my own commit'", { cwd: root });

    expect(await headIsCheckpoint(root)).toBe(false);
    const undone = await undoCheckpoint(root);
    expect(undone.ok).toBe(false);
    expect(undone.message).toContain("not made by the agent");
    // Their work is still there.
    expect(existsSync(join(root, "mine.js"))).toBe(true);
  }, 30_000);

  it("lists only the agent's checkpoints, not every commit", async () => {
    const root = await repo();
    writeFileSync(join(root, "a.js"), "1\n");
    await checkpoint(root, "first");
    writeFileSync(join(root, "b.js"), "2\n");
    await runShell("git add -A && git commit -qm 'human commit'", { cwd: root });

    const list = await listCheckpoints(root);
    expect(list).toHaveLength(1);
    expect(list[0]).toContain("first");
  }, 30_000);
});

describe("git as the agent reads it", () => {
  /** A repository with one committed file, the state a run starts from. */
  async function seeded(): Promise<string> {
    const root = await repo();
    writeFileSync(join(root, "a.txt"), "original\n");
    await runShell("git add -A && git commit -qm seed", { cwd: root });
    return root;
  }

  it("shows work the run has already checkpointed, not an empty diff", async () => {
    // The bug: the orchestrator checkpoints after each changed turn, so a plain
    // `git diff` right after an edit shows nothing. On a live run the agent read
    // that as its edit having vanished and spent fifteen steps looking for it.
    const root = await seeded();
    writeFileSync(join(root, "a.txt"), "changed\n");
    await checkpoint(root, "the change");

    const plain = await runShell("git diff", { cwd: root });
    expect(plain.stdout.trim()).toBe("");

    const asAgent = await agentDiff(root);
    expect(asAgent.stdout).toContain("-original");
    expect(asAgent.stdout).toContain("+changed");
  }, 30_000);

  it("includes uncommitted work as well as checkpointed work", async () => {
    const root = await seeded();
    writeFileSync(join(root, "a.txt"), "checkpointed\n");
    await checkpoint(root, "one");
    writeFileSync(join(root, "b.txt"), "not yet committed\n");

    const diff = await agentDiff(root);
    expect(diff.stdout).toContain("checkpointed");
    expect(diff.stdout).toContain("b.txt");
  }, 30_000);

  it("says what changed in the run even when the tree is clean", async () => {
    const root = await seeded();
    writeFileSync(join(root, "a.txt"), "changed\n");
    await checkpoint(root, "the change");

    const status = await agentStatus(root);
    expect(status.stdout).toContain("Nothing uncommitted");
    expect(status.stdout).toContain("already checkpointed");
    expect(status.stdout).toContain("a.txt");
  }, 30_000);

  it("behaves like plain git before the run has changed anything", async () => {
    const root = await seeded();
    const status = await agentStatus(root);
    expect(status.stdout).not.toContain("already checkpointed");
    expect((await agentDiff(root)).stdout.trim()).toBe("");
  }, 30_000);
});
