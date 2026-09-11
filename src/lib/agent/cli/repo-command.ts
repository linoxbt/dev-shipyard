import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  branchNameFor,
  changedFiles,
  fetchTarball,
  getRepo,
  openPullRequest,
  parseRepo,
} from "../../github-repos";
import { filesFromArchive, readTarGz } from "../../repo-archive";
import { initLocalRepo, materialise, proposalFor, readWorkspace } from "../repo-session";
import { runCommand, type CommandContext, type RunOutcome } from "./commands";
import type { Handoff, RunResult } from "../orchestrator";
import type { Proposal } from "../repo-session";
import { PULL_REQUEST_ADDENDUM } from "../system-prompt";
import { isYes } from "./commands";
import { CLI_NAME } from "./args";

// Working on somebody's real repository, start to finish.
//
// The shape is the same handoff every outward action in this system uses: the
// agent edits files and nothing else, and the person opens the pull request.
// Here the person is at a terminal, so "their session" is this process holding
// their own token; in the web app it is their signed-in cookie. Neither puts a
// credential in the workspace, and neither lets the model decide that a change
// is ready to be published.

export interface RepoRunOptions {
  token: string;
  /** Where to put the workspace. Defaults to a directory under the current one
   *  so `status`, `diff` and `undo` all work against it afterwards. */
  workspaceRoot?: string;
  ref?: string;
  now?: Date;
  /** Injected in tests. The real one asks the person at the terminal. */
  confirm?: (summary: string) => Promise<boolean>;
}

export interface RepoRunResult {
  code: number;
  workspace?: string;
  pullRequestUrl?: string;
  changed: string[];
}

function workspaceFor(root: string, owner: string, name: string, now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const dir = join(root, ".devstation", "repos", `${owner}-${name}-${stamp}`);
  mkdirSync(dir, { recursive: true });
  // Self-ignoring, for the same reason .agent is: a checkout of somebody's
  // repository has no business appearing in the history of whatever directory
  // this happened to be run from.
  const ignore = join(root, ".devstation", ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  return dir;
}

export async function repoCommand(
  context: CommandContext,
  repoInput: string,
  goal: string,
  options: RepoRunOptions,
): Promise<RepoRunResult> {
  const { terminal } = context;
  const now = options.now ?? new Date();

  const parsed = parseRepo(repoInput);
  if (!parsed) {
    terminal.err(`"${repoInput}" is not a repository. Give it owner/name or a GitHub URL.`);
    return { code: 2, changed: [] };
  }
  if (!goal.trim()) {
    terminal.err(`Say what to do: ${CLI_NAME} repo ${repoInput} "fix the failing test"`);
    return { code: 2, changed: [] };
  }

  let repo;
  try {
    repo = await getRepo(options.token, parsed.owner, parsed.name);
  } catch (error) {
    terminal.err(`Could not open ${parsed.owner}/${parsed.name}: ${message(error)}`);
    return { code: 1, changed: [] };
  }

  const ref = options.ref || repo.defaultBranch;
  terminal.out(`${repo.fullName} at ${ref}${repo.private ? " (private)" : ""}`);

  let before: Record<string, string>;
  let skipped: Array<{ path: string; why: string }>;
  try {
    const archive = readTarGz(await fetchTarball(options.token, repo.owner, repo.name, ref));
    const read = filesFromArchive(archive);
    if ("error" in read) {
      terminal.err(read.error);
      return { code: 1, changed: [] };
    }
    before = read.files;
    skipped = read.skipped;
  } catch (error) {
    terminal.err(`Could not download the repository: ${message(error)}`);
    return { code: 1, changed: [] };
  }

  const count = Object.keys(before).length;
  terminal.out(
    `${count} text file(s)${skipped.length ? `, ${skipped.length} left out (binary or too large)` : ""}`,
  );
  if (count === 0) {
    terminal.err("There is nothing here the agent can read.");
    return { code: 1, changed: [] };
  }

  const workspace = workspaceFor(options.workspaceRoot ?? context.root, repo.owner, repo.name, now);
  const written = materialise(before, workspace);
  for (const refused of written.refused) {
    terminal.out(`not written: ${refused.path} (${refused.why})`);
  }
  await initLocalRepo(workspace, ref);
  terminal.out(`workspace ${workspace}`);
  terminal.out("");

  const run = await runCommand({ ...context, root: workspace }, goal, {
    systemAddendum: PULL_REQUEST_ADDENDUM,
    // The agent may name its own pull request. It cannot open one: calling the
    // tool records what it would say, and the decision below is still a
    // person's, made with the finished diff in view.
    offerPersonTools: ["open_pull_request"],
  });

  const change = changedFiles(before, readWorkspace(workspace));
  const changedPaths = [...Object.keys(change.files), ...change.deleted].sort();

  terminal.out("");
  if (changedPaths.length === 0) {
    // Said plainly rather than opening an empty pull request. The agent
    // reporting files it wrote is not the same as those files differing.
    terminal.out("Nothing changed, so there is no pull request to open.");
    return { code: run.code, workspace, changed: [] };
  }

  const proposal = merge(proposalFor(goal, toRunResult(run), changedPaths), run.result?.handoffs);
  terminal.out(`Proposed pull request against ${repo.fullName}:`);
  terminal.out(`  title  ${proposal.title}`);
  terminal.out(`  base   ${ref}`);
  terminal.out(`  files  ${changedPaths.join(", ")}`);
  terminal.out("");

  const approved = options.confirm
    ? await options.confirm(proposal.title)
    : isYes(await terminal.ask(`Open this pull request on ${repo.fullName}? [y/N] `));

  if (!approved) {
    terminal.out(`Not opened. The work is still in ${workspace}.`);
    return { code: 0, workspace, changed: changedPaths };
  }

  const branch = branchNameFor(goal, now);
  try {
    const pull = await openPullRequest(
      options.token,
      repo.owner,
      repo.name,
      {
        files: change.files,
        deleted: change.deleted,
        message: proposal.message,
        branch,
        base: ref,
      },
      { title: proposal.title, body: proposal.body },
    );
    terminal.out(`Opened ${pull.url}`);
    return { code: 0, workspace, pullRequestUrl: pull.url, changed: changedPaths };
  } catch (error) {
    terminal.err(`The pull request was not opened: ${message(error)}`);
    terminal.err(`Nothing was changed on GitHub. The work is still in ${workspace}.`);
    return { code: 1, workspace, changed: changedPaths };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The run's result, falling back to the session when the run never produced
 *  one. The session carries the same numbers under different names. */
function toRunResult(run: RunOutcome): RunResult {
  if (run.result) return run.result;
  const { session } = run;
  return {
    ok: run.code === 0,
    summary: session.summary,
    steps: session.steps,
    filesChanged: session.filesChanged,
    usage: session.usage,
    costUsd: session.costUsd,
    messages: session.messages,
    stoppedBecause: session.stoppedBecause,
    handoffs: [],
  };
}

/** Prefer the title and body the agent wrote for the pull request over the one
 *  derived from its closing message.
 *
 *  Those are two different pieces of writing. The closing message answers "did
 *  it work", and taking its first line gave pull requests called "Both tests
 *  pass now.", which says nothing about the change. A title written as a title
 *  says what changed. */
function merge(fallback: Proposal, handoffs: Handoff[] | undefined): Proposal {
  const proposed = [...(handoffs ?? [])].reverse().find((h) => h.tool === "open_pull_request");
  if (!proposed) return fallback;

  const title = typeof proposed.args.title === "string" ? proposed.args.title.trim() : "";
  const body = typeof proposed.args.body === "string" ? proposed.args.body.trim() : "";
  return {
    title: title || fallback.title,
    // The agent's own description first, then the facts about the run, which
    // are ours to state and not the model's to claim.
    body: body ? `${body}\n\n---\n\n${fallback.body}` : fallback.body,
    message: `${title || fallback.title}\n\n${fallback.message.split("\n\n").slice(1).join("\n\n")}`,
  };
}
