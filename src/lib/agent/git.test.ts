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
