import { existsSync } from "node:fs";
import { join } from "node:path";
import { runShell, type ShellResult } from "./shell";

// Git, and the checkpoints that make `undo` possible.
//
// Checkpointing through git rather than a copy directory is a deliberate
// choice: a checkpoint you can read with `git log` and `git diff` is one a
// person can inspect and trust, and one they can recover from by hand if this
// code is wrong. A hidden folder of file copies is opaque at exactly the moment
// someone needs to understand what happened.
//
// Undo only ever rewinds commits this agent made. The marker below is how it
// tells them apart, and why it will not quietly discard a commit someone else
// wrote that happens to sit on top.

/** Prefix on every commit the agent makes on its own behalf. Anything without
 *  it is somebody else's work and is never rewound. */
export const CHECKPOINT_PREFIX = "agent checkpoint:";

export type GitOp =
  | "status"
  | "log"
  | "diff"
  | "show"
  | "branch"
  | "add"
  | "commit"
  | "init"
  | "checkout"
  | "rev-parse";

/** Read-only operations, so the gate can let them through without asking. */
export const READ_ONLY_OPS = new Set<GitOp>(["status", "log", "diff", "show", "rev-parse"]);

export function isRepo(root: string): boolean {
  return existsSync(join(root, ".git"));
}

/** Shell-quote a single argument. Arguments come from a model, so they are
 *  never interpolated raw. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export async function git(
  root: string,
  op: GitOp,
  args: string[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<ShellResult> {
  const command = `git ${op} ${args.map(quote).join(" ")}`.trim();
  return runShell(command, { cwd: root, timeoutMs: opts.timeoutMs ?? 60_000 });
}

/** Files git reports as changed, staged or not, relative to the repo root. */
export async function changedFiles(root: string): Promise<string[]> {
  const result = await runShell("git status --porcelain", { cwd: root, timeoutMs: 30_000 });
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

export interface CheckpointResult {
  ok: boolean;
  /** Null when there was nothing to commit, which is not a failure. */
  sha: string | null;
  message: string;
}

/**
 * Commit whatever changed, tagged as the agent's.
 *
 * Nothing to commit is a success with a null sha, not an error: a turn that
 * verified cleanly without touching a file is a perfectly ordinary outcome and
 * should not read as a failure in the event log.
 */
export async function checkpoint(root: string, description: string): Promise<CheckpointResult> {
  if (!isRepo(root)) return { ok: false, sha: null, message: "Not a git repository." };

  const changed = await changedFiles(root);
  if (changed.length === 0) return { ok: true, sha: null, message: "Nothing to check point." };

  const add = await runShell("git add -A", { cwd: root, timeoutMs: 60_000 });
  if (!add.ok) return { ok: false, sha: null, message: add.stderr || "git add failed." };

  const subject = `${CHECKPOINT_PREFIX} ${description}`.slice(0, 200);
  // Identity is supplied per-invocation rather than written into the repo's
  // config, so checkpointing never mutates the user's git settings.
  const commit = await runShell(
    `git -c user.name='DevStation agent' -c user.email='agent@devstation.online' commit -m ${quote(subject)}`,
    { cwd: root, timeoutMs: 60_000 },
  );
  if (!commit.ok) return { ok: false, sha: null, message: commit.stderr || "git commit failed." };

  const head = await runShell("git rev-parse HEAD", { cwd: root, timeoutMs: 30_000 });
  return { ok: true, sha: head.stdout.trim() || null, message: subject };
}

/** Is HEAD a commit this agent made? */
export async function headIsCheckpoint(root: string): Promise<boolean> {
  const result = await runShell("git log -1 --pretty=%s", { cwd: root, timeoutMs: 30_000 });
  return result.ok && result.stdout.trim().startsWith(CHECKPOINT_PREFIX);
}

/**
 * Rewind the most recent agent checkpoint.
 *
 * Refuses when HEAD is not one. That is the important part: if someone
 * committed on top of the agent's work, a blind `reset --hard HEAD~1` would
 * throw away their commit instead of the agent's, and they would have no
 * warning it happened.
 */
export async function undoCheckpoint(root: string): Promise<{ ok: boolean; message: string }> {
  if (!isRepo(root))
    return { ok: false, message: "Not a git repository, so there is nothing to undo." };
  if (!(await headIsCheckpoint(root))) {
    return {
      ok: false,
      message:
        "The most recent commit was not made by the agent, so nothing was undone. " +
        "Undo only ever rewinds the agent's own checkpoints.",
    };
  }
  const subject = await runShell("git log -1 --pretty=%s", { cwd: root, timeoutMs: 30_000 });
  const reset = await runShell("git reset --hard HEAD~1", { cwd: root, timeoutMs: 60_000 });
  if (!reset.ok) return { ok: false, message: reset.stderr || "git reset failed." };
  return { ok: true, message: `Undid ${subject.stdout.trim()}` };
}

/**
 * The newest commit that the agent did not make.
 *
 * This is what "what has the agent changed" is measured against: everything
 * from here to the working tree is the agent's, and everything before it is
 * the person's. Null when the agent's checkpoints go all the way back, which
 * happens in a repository it started itself.
 */
export async function checkpointBase(root: string): Promise<string | null> {
  if (!isRepo(root)) return null;
  const log = await runShell("git log --pretty=%H%x09%s -n 200", { cwd: root, timeoutMs: 30_000 });
  if (!log.ok) return null;
  for (const line of log.stdout.split("\n")) {
    const [sha, ...rest] = line.split("\t");
    if (!sha) continue;
    if (!rest.join("\t").startsWith(CHECKPOINT_PREFIX)) return sha;
  }
  return null;
}

/** The agent's checkpoints, newest first. */
export async function listCheckpoints(root: string, limit = 20): Promise<string[]> {
  if (!isRepo(root)) return [];
  const result = await runShell(`git log -${limit} --pretty=%h%x09%s`, {
    cwd: root,
    timeoutMs: 30_000,
  });
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.includes(CHECKPOINT_PREFIX))
    .map((line) => line.trim())
    .filter(Boolean);
}
