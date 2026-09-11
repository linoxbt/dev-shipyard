// Agent runs against somebody's real repository.
//
// Separate from agent.ts on purpose. That one drives the generated-app
// pipeline: a prompt in, a whole app out. This one drives the orchestrator
// over a workspace that already exists, which is a different job with a
// different ending: a set of changed files, and a proposal that only the
// person's own session can act on.
//
// The invariant that shapes all of it: no GitHub credential ever arrives here.
// The app's server holds the OAuth cookie, downloads the repository, and sends
// the text. This process gets files and a goal, and hands back files and a
// proposal. It could not open a pull request if it wanted to.

import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { Orchestrator, type AgentEvent } from "../../../src/lib/agent/orchestrator";
import { Workspace } from "../../../src/lib/agent/workspace";
import {
  initLocalRepo,
  materialise,
  proposalFor,
  readWorkspace,
} from "../../../src/lib/agent/repo-session";
import { changedFiles } from "../../../src/lib/github-repos";
import { providerFromEnv, type ModelProvider } from "../../../src/lib/agent/providers";
import { PULL_REQUEST_ADDENDUM } from "../../../src/lib/agent/system-prompt";
import { embeddingsFromEnv } from "../../../src/lib/agent/memory/embeddings";
import { indexWorkspace, openStore } from "../../../src/lib/agent/memory/workspace-index";
import type { MemoryStore } from "../../../src/lib/agent/memory/store";
import { fileStore } from "../../../src/lib/agent/store";

export const REPO_JOB_TTL_MS = 6 * 60 * 60 * 1000;
export const MAX_REPO_JOBS = 40;
/** Runs are capped here as well as in the orchestrator, because the cap that
 *  matters to the host is how long a workspace occupies its disk. */
const MAX_STEPS = 40;
const MAX_MS = 15 * 60_000;

const STATE_DIR = process.env.RUNNER_STATE_DIR ?? "/var/lib/devstation-runner";
const REPO_DIR = join(STATE_DIR, "repo-agent");

export type RepoJobPhase = "running" | "done" | "error" | "cancelled";

export interface RepoJob {
  id: string;
  /** Where the workspace lives. Recorded on the job rather than recomputed, so
   *  the sweeper can still delete it after a restart, and so a job started
   *  against a different state directory is cleaned up from the right place. */
  root: string;
  repo: string;
  ref: string;
  goal: string;
  createdAt: number;
  updatedAt: number;
  phase: RepoJobPhase;
  status: string;
  summary: string;
  events: AgentEvent[];
  /** Only what differs from what came in. The rest of the repository is
   *  carried through by the base tree when the pull request is built. */
  changed: Record<string, string>;
  deleted: string[];
  steps: number;
  costUsd: number;
  /** What the agent proposed the pull request should say. */
  proposal: { title: string; body: string } | null;
  error: string | null;
}

/** What a poll returns. The file contents are deliberately left out: a browser
 *  polling every second does not need the whole diff every time, and the pull
 *  request is built from the copy held here rather than from anything the page
 *  sends back. */
export type RepoJobView = Omit<RepoJob, "changed" | "root"> & { changedPaths: string[] };

const jobs = new Map<string, RepoJob>();
const running = new Map<string, AbortController>();
let store = fileStore(join(REPO_DIR, "jobs.json"));

export function initRepoStore(): void {
  mkdirSync(REPO_DIR, { recursive: true });
  store = fileStore(join(REPO_DIR, "jobs.json"));
  const raw = store.load();
  let saved: Record<string, RepoJob> = {};
  try {
    saved = raw ? (JSON.parse(raw) as Record<string, RepoJob>) : {};
  } catch {
    // An unparseable file means the jobs are gone, which is where a restart
    // left us anyway. Better than refusing to start.
    saved = {};
  }
  for (const [id, job] of Object.entries(saved)) {
    // A job that was running when the process died did not survive it. Saying
    // so is better than leaving a spinner going forever in somebody's tab.
    jobs.set(id, job.phase === "running" ? { ...job, phase: "error", error: STOPPED } : job);
  }
}

const STOPPED = "The runner restarted while this was working. Nothing was published.";

function persist() {
  store.save(JSON.stringify(Object.fromEntries(jobs)));
}

function workspaceFor(id: string, stateDir?: string): string {
  return join(stateDir ?? REPO_DIR, "workspaces", id);
}

export function sweepRepoJobs(now = Date.now()): number {
  let removed = 0;
  for (const [id, job] of [...jobs]) {
    if (now - job.updatedAt <= REPO_JOB_TTL_MS) continue;
    dropJob(id);
    removed++;
  }
  // Oldest first once over the cap, so a busy day cannot fill the disk.
  const ordered = [...jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt);
  while (jobs.size > MAX_REPO_JOBS && ordered.length > 0) {
    dropJob(ordered.shift()!.id);
    removed++;
  }
  if (removed > 0) persist();
  return removed;
}

function dropJob(id: string) {
  const job = jobs.get(id);
  running.get(id)?.abort();
  running.delete(id);
  jobs.delete(id);
  if (job) rmSync(job.root, { recursive: true, force: true });
}

export interface StartRepoJobInput {
  repo: string;
  ref: string;
  goal: string;
  files: Record<string, string>;
  /** The model to use. The HTTP route never supplies one and the environment
   *  decides; a caller that already holds a provider can pass it, which is what
   *  lets the whole job run offline under the mock. */
  provider?: ModelProvider;
  /** Where workspaces go. Defaults to the runner's state directory. */
  stateDir?: string;
}

export function startRepoJob(input: StartRepoJobInput): RepoJob {
  sweepRepoJobs();
  const id = randomBytes(9).toString("hex");
  const now = Date.now();

  const job: RepoJob = {
    id,
    root: workspaceFor(id, input.stateDir),
    repo: input.repo,
    ref: input.ref,
    goal: input.goal,
    createdAt: now,
    updatedAt: now,
    phase: "running",
    status: "Setting up the workspace",
    summary: "",
    events: [],
    changed: {},
    deleted: [],
    steps: 0,
    costUsd: 0,
    proposal: null,
    error: null,
  };
  jobs.set(id, job);
  persist();

  const controller = new AbortController();
  running.set(id, controller);
  // Deliberately not awaited: the caller gets an id in milliseconds and polls.
  const settled = run(job, input, controller.signal).finally(() => running.delete(id));
  finished.set(id, settled);
  return job;
}

/** Events are kept but capped. A long run produces hundreds, and a browser
 *  re-reading all of them on every poll is a slow page and a large response. */
const MAX_EVENTS = 400;

/** Resolves when a job's run has settled. Not part of the HTTP surface: a
 *  poller has the phase for that. It exists so a test can await a job rather
 *  than sleep and hope. */
const finished = new Map<string, Promise<void>>();

export function whenSettled(id: string): Promise<void> {
  return finished.get(id) ?? Promise.resolve();
}

async function run(job: RepoJob, input: StartRepoJobInput, signal: AbortSignal) {
  const files = input.files;
  const root = job.root;
  let memory: MemoryStore | null = null;

  const touch = (patch: Partial<RepoJob>) => {
    Object.assign(job, patch, { updatedAt: Date.now() });
    persist();
  };

  try {
    mkdirSync(root, { recursive: true });
    const written = materialise(files, root);
    await initLocalRepo(root, job.ref);
    touch({ status: `${written.written} file(s) ready` });

    const provider = input.provider ?? providerFromEnv();
    if (!provider) {
      touch({
        phase: "error",
        error: "No model provider is configured on the runner.",
        status: "Stopped",
      });
      return;
    }

    const embeddings = embeddingsFromEnv();
    try {
      memory = openStore(root);
      await indexWorkspace(root, { store: memory, embeddings });
    } catch {
      memory = null;
    }

    const result = await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      signal,
      maxSteps: MAX_STEPS,
      maxMs: MAX_MS,
      taskId: job.id,
      projectId: job.repo,
      memory,
      embeddings,
      systemAddendum: PULL_REQUEST_ADDENDUM,
      offerPersonTools: ["open_pull_request"],
      // No approver. Everything gated is refused, and the agent is told so,
      // because there is nobody at this end of the connection to ask and a
      // question nobody can answer is worse than a clear no.
      onEvent: (event) => {
        job.events.push(event);
        if (job.events.length > MAX_EVENTS) job.events.splice(0, job.events.length - MAX_EVENTS);
        touch({ status: event.message.slice(0, 200) });
      },
    }).run(job.goal);

    const change = changedFiles(files, readWorkspace(root));
    const paths = [...Object.keys(change.files), ...change.deleted].sort();
    const proposed = [...result.handoffs].reverse().find((h) => h.tool === "open_pull_request");
    const fallback = proposalFor(job.goal, result, paths);

    touch({
      phase: signal.aborted ? "cancelled" : "done",
      status: signal.aborted ? "Stopped" : "Finished",
      summary: result.summary,
      steps: result.steps,
      costUsd: result.costUsd,
      changed: change.files,
      deleted: change.deleted,
      proposal: {
        title:
          (typeof proposed?.args.title === "string" && proposed.args.title.trim()) ||
          fallback.title,
        body:
          (typeof proposed?.args.body === "string" && proposed.args.body.trim()) || fallback.body,
      },
    });
  } catch (error) {
    touch({
      phase: "error",
      status: "Stopped",
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    memory?.close();
  }
}

export function getRepoJob(id: string): RepoJob | null {
  sweepRepoJobs();
  return jobs.get(id) ?? null;
}

/** The job as the browser sees it. */
export function viewOf(job: RepoJob): RepoJobView {
  // The file contents and the path on the host are both left out. A browser
  // polling every second does not need the diff, and where the workspace sits
  // on disk is nobody's business outside this process.
  const { changed, root, ...rest } = job;
  void root;
  return { ...rest, changedPaths: Object.keys(changed).sort() };
}

export function cancelRepoJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job || job.phase !== "running") return false;
  running.get(id)?.abort();
  job.phase = "cancelled";
  job.status = "Stopped";
  job.updatedAt = Date.now();
  persist();
  return true;
}

/** The change itself, for the one caller that is allowed to have it: the app's
 *  server, which holds the person's session and is about to ask them whether
 *  to open the pull request. */
export function changeFor(id: string): { files: Record<string, string>; deleted: string[] } | null {
  const job = jobs.get(id);
  if (!job || job.phase !== "done") return null;
  return { files: job.changed, deleted: job.deleted };
}

export function activeRepoJobs(): number {
  return running.size;
}
