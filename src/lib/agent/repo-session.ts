import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { looksBinary, Workspace } from "./workspace";
import { runShell } from "./shell";
import type { RunResult } from "./orchestrator";

// Running the agent against a repository somebody already has.
//
// The repository arrives as a file map, is written into a workspace, worked on
// like any other workspace, and leaves as a file map again. No git remote is
// configured and no credential is written anywhere in it, which is what keeps
// the pull request the person's action: the agent produces edited files and
// nothing else, and the signed-in session turns those into a branch.
//
// The workspace still gets its own local `git init` and first commit. That is
// not for pushing; it is so checkpoints and undo work exactly as they do on a
// local repository, and so the agent can run `git diff` to see its own work.

/** Directories never read back out of a workspace.
 *
 *  `.agent` and `.devstation` are the important ones and were found by a test:
 *  without them the agent's own session transcript and event log are read back
 *  as "changed files" and committed into the pull request, publishing whatever
 *  the run happened to have in context into somebody's repository. The rest are
 *  build output and dependencies, kept in step with what the archive reader
 *  drops on the way in. */
const SKIP_DIRS = new Set([
  ".git",
  ".agent",
  ".devstation",
  "node_modules",
  ".next",
  "dist",
  "build",
  ".turbo",
]);

export interface Materialised {
  written: number;
  /** Paths the workspace refused, with its reason. Reported rather than
   *  swallowed: a file missing from the workspace changes what the agent can
   *  conclude about the repository. */
  refused: Array<{ path: string; why: string }>;
}

export function materialise(files: Record<string, string>, root: string): Materialised {
  const workspace = new Workspace(root);
  const refused: Array<{ path: string; why: string }> = [];
  let written = 0;

  for (const [path, content] of Object.entries(files)) {
    const result = workspace.write(path, content);
    if (result.ok) written++;
    else refused.push({ path, why: result.reason });
  }
  return { written, refused };
}

/**
 * A local repository, so checkpoints and undo behave normally.
 *
 * The identity is supplied per-invocation and no remote is added. A workspace
 * that cannot push is a workspace that cannot push by accident.
 */
export async function initLocalRepo(root: string, ref: string): Promise<boolean> {
  const result = await runShell(
    "git init -q && git add -A && " +
      "git -c user.name='DevStation agent' -c user.email='agent@devstation.online' " +
      `commit -q -m ${JSON.stringify(`base: ${ref}`)} --allow-empty`,
    { cwd: root, timeoutMs: 120_000 },
  );
  return result.ok;
}

/** Every text file in the workspace, as a map, ready to compare against what
 *  went in. Read from disk rather than from what the agent said it wrote: a
 *  tool that reported success and did nothing would otherwise produce an empty
 *  pull request with a confident description. */
export function readWorkspace(root: string, maxFileBytes = 1024 * 1024): Record<string, string> {
  const files: Record<string, string> = {};

  const walk = (dir: string) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue; // never follow a link out of the tree
      const full = join(dir, item.name);
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue;
        walk(full);
        continue;
      }
      if (!item.isFile()) continue;
      if (statSync(full).size > maxFileBytes) continue;
      const buffer = readFileSync(full);
      if (looksBinary(buffer)) continue;
      files[relative(root, full).split(sep).join("/")] = buffer.toString("utf8");
    }
  };

  walk(root);
  return files;
}

export interface Proposal {
  title: string;
  body: string;
  message: string;
}

const MAX_TITLE = 72;

/** What the pull request says.
 *
 *  Written from the run, not by asking the model a second time: a separate
 *  "now summarise what you did" turn costs money and is free to describe work
 *  that did not happen. The files listed here are the ones actually about to
 *  be committed.
 */
export function proposalFor(goal: string, result: RunResult, files: string[]): Proposal {
  // The goal, not the closing message. They are different kinds of sentence:
  // the goal describes the change that was wanted, the closing message reports
  // whether it worked. Taking the first line of the latter produced live pull
  // requests titled "Both tests pass now." and "Done. Summary:". This is only
  // the fallback; the agent is asked for a real title and it is preferred.
  const firstLine = (goal || result.summary).split("\n")[0].trim();
  const title =
    firstLine.length > MAX_TITLE ? `${firstLine.slice(0, MAX_TITLE - 3)}...` : firstLine;

  const fileList =
    files.length === 0
      ? "_No files changed._"
      : files
          .slice(0, 50)
          .map((f) => `- \`${f}\``)
          .join("\n") + (files.length > 50 ? `\n- ...and ${files.length - 50} more` : "");

  const body = [
    `**Asked for:** ${goal}`,
    "",
    result.summary || "No summary was produced.",
    "",
    "### Files changed",
    fileList,
    "",
    "---",
    `Opened by the DevStation coding agent after ${result.steps} step(s), ` +
      `about $${result.costUsd.toFixed(2)}. Review it as you would any other change: ` +
      "nothing here has been merged, and the agent could not open this itself.",
  ].join("\n");

  return { title, body, message: `${title}\n\n${goal}` };
}
