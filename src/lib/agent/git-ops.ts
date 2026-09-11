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
  | "rev-parse";

/** Operations that cannot change anything, so they never need approval. */
export const READ_ONLY_OPS = new Set<GitOp>(["status", "log", "diff", "show", "rev-parse"]);
