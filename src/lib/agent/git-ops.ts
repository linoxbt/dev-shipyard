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
