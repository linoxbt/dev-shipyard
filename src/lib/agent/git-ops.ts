// The git operations the agent may ask for, and which of them only read.
//
// Separated from git.ts for the same reason command-class.ts is separated from
// shell.ts: the tool registry needs these names, the registry is imported by
// the browser, and git.ts reaches for node:fs and spawns a process.

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
  | "rev-parse"
  | "clone";

/** Operations that cannot change anything, so they never need approval. */
export const READ_ONLY_OPS = new Set<GitOp>(["status", "log", "diff", "show", "rev-parse"]);

/**
 * Why this URL is not safe to hand to `git clone`, or null.
 *
 * Pure, and here rather than in git.ts, because the registry classifies a call
 * before anything runs and the registry is imported by the browser.
 *
 * `git clone` is not merely a download. Its `ext::` transport runs a command
 * by design, `--upload-pack` names a program to execute, and a URL that begins
 * with a dash is read as an option rather than an address. A model-supplied
 * string reaching any of those is remote code execution on whatever machine
 * the clone runs on, which for an unsandboxed run is the user's own. So this
 * is an allow-list of transports and not a list of things to reject: a
 * transport nobody anticipated fails closed.
 */
export function cloneUrlProblem(url: string): string | null {
  const value = url.trim();
  if (!value) return "A clone needs a repository URL.";
  if (value.length > 2000) return "That URL is implausibly long.";
  if (value.startsWith("-"))
    return "A URL cannot start with a dash: git would read it as an option.";
  if (/\s/.test(value)) return "A repository URL cannot contain whitespace.";

  // https, ssh and git over the wire, plus the scp-like form git accepts
  // (git@github.com:owner/repo.git). Everything else, including ext:: and
  // file://, is refused: ext:: executes a command, and file:// reaches into
  // the host filesystem, which is the boundary the workspace exists to hold.
  const url_ = /^(https?|ssh|git):\/\/[^/@\s]+(@[^/\s]+)?\/\S+$/i;
  const scp = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+$/;
  if (!url_.test(value) && !scp.test(value)) {
    return (
      "That does not look like a repository URL. Use https://, ssh:// or git@host:owner/repo. " +
      "Local paths and git's ext:: transport are not accepted."
    );
  }
  return null;
}

/** The directory `git clone <url>` would create, which is what git itself
 *  picks when no target is given. */
export function cloneDirName(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  const last = trimmed.split(/[/:]/).pop() ?? "";
  return last.replace(/\.git$/i, "") || "repo";
}

/** Why this is not a usable target directory for a clone, or null. A pure
 *  string check, so the registry can refuse it before anyone is asked to
 *  approve anything; the workspace does the authoritative check later. */
export function cloneTargetProblem(target: string): string | null {
  const value = target.trim();
  if (!value) return null; // absent is fine: git picks the name from the URL
  if (value.startsWith("-")) return "A target directory cannot start with a dash.";
  const parts = value.replace(/\\/g, "/").split("/");
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value) || parts.includes("..")) {
    return "The target directory has to be inside the workspace.";
  }
  return null;
}

/** The flags each operation may take. Anything else starting with `-` is
 *  refused.
 *
 *  The arguments are shell-quoted, which stops `; curl x | sh` but not git's
 *  own options, and several of those run programs or write files: `git log
 *  --output=/home/u/.bashrc --format=...` wrote anywhere on the host as an
 *  "inspect" that never asked. `--ext-diff`, `--textconv`, `--exec-path`,
 *  `-c`, `--upload-pack` are the same shape. A deny-list would be one flag
 *  behind git forever, so this is an allow-list. Values may be attached with
 *  `=`; a value given as the next argument is positional and passes as one. */
const FLAGS: Record<Exclude<GitOp, "clone">, readonly string[]> = {
  status: ["-s", "--short", "--porcelain", "-b", "--branch", "-u", "--untracked-files"],
  log: [
    "-n",
    "--max-count",
    "--oneline",
    "--stat",
    "--shortstat",
    "--numstat",
    "--name-only",
    "--name-status",
    "-p",
    "--patch",
    "--no-patch",
    "--graph",
    "--decorate",
    "--all",
    "--since",
    "--until",
    "--after",
    "--before",
    "--author",
    "--grep",
    "--format",
    "--pretty",
    "--reverse",
    "--follow",
    "--no-merges",
    "--merges",
    "--abbrev-commit",
    "--date",
    "--first-parent",
    "-S",
    "-G",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
  ],
  show: [
    "--stat",
    "--shortstat",
    "--numstat",
    "--name-only",
    "--name-status",
    "--format",
    "--pretty",
    "--oneline",
    "-p",
    "--patch",
    "--no-patch",
    "-s",
    "--abbrev-commit",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
  ],
  diff: [
    "--stat",
    "--shortstat",
    "--numstat",
    "--name-only",
    "--name-status",
    "--cached",
    "--staged",
    "-U",
    "--unified",
    "--word-diff",
    "--no-color",
    "-w",
    "--ignore-all-space",
    "-b",
    "--ignore-space-change",
    "--minimal",
    "--patience",
    "--histogram",
    "--diff-filter",
    "-M",
    "--find-renames",
    "--summary",
    "--check",
    "--no-ext-diff",
    "--no-textconv",
  ],
  branch: [
    "-a",
    "--all",
    "-r",
    "--remotes",
    "-v",
    "-vv",
    "--verbose",
    "--list",
    "--show-current",
    "--merged",
    "--no-merged",
    "--contains",
  ],
  add: ["-A", "--all", "-u", "--update", "-N", "--intent-to-add", "-n", "--dry-run", "-v"],
  commit: ["-m", "--message", "-a", "--all", "--allow-empty", "-q", "--quiet"],
  init: ["-q", "--quiet", "-b", "--initial-branch"],
  checkout: ["-b", "-q", "--quiet"],
  "rev-parse": [
    "--abbrev-ref",
    "--short",
    "--verify",
    "--show-toplevel",
    "--is-inside-work-tree",
    "--symbolic-full-name",
  ],
};

/** Why these arguments are not acceptable for `op`, or null. */
export function gitArgsProblem(op: GitOp, args: readonly string[]): string | null {
  if (op === "clone") return args.length ? "clone takes url and target_dir, not args." : null;
  const allowed = new Set(FLAGS[op] ?? []);
  let afterSeparator = false;
  for (const arg of args) {
    if (afterSeparator) continue;
    if (arg === "--") {
      afterSeparator = true;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") continue;
    // -5 is `log -n 5`, and -U3 is `diff -U 3`.
    if (op === "log" && /^-\d+$/.test(arg)) continue;
    if (op === "diff" && /^-U\d+$/.test(arg)) continue;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!allowed.has(name)) {
      return `git ${op} does not accept ${name} here. Allowed: ${[...allowed].join(" ")}.`;
    }
  }
  return null;
}
