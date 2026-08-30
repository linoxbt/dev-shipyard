// What happened, and when.
//
// Jobs were entirely ephemeral before this: a container was created, phases
// ran, a response went out, and nothing survived. That is fine for a build
// service and useless for watching one — "did last night's failure look like
// this morning's?" had no answer.
//
// Kept on disk rather than in memory because the service restarts on every
// deploy, and history that empties whenever you change something is history
// you learn to distrust.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Jobs retained. Two hundred is a few days of real use and keeps the file
 *  small enough to read and rewrite whole. */
export const MAX_JOBS = 200;
/** Jobs are also dropped once they are this old, regardless of count.
 *
 *  Job logs contain fragments of user code and build output. Capping only by
 *  count meant a quiet week kept months of other people's source on disk
 *  indefinitely; an age bound makes retention a stated policy rather than an
 *  accident of traffic. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Log kept per phase. Failures get the tail, where the error is; successes
 *  get a token amount, enough to see "added 2 packages" and no more. */
const FAIL_LOG_CHARS = 2500;
const PASS_LOG_CHARS = 400;

const STATE_DIR = process.env.RUNNER_STATE_DIR ?? "/var/lib/devstation-runner";
const HISTORY_FILE = join(STATE_DIR, "history.json");

export interface PhaseRecord {
  phase: string;
  ok: boolean;
  durationMs: number;
  timedOut: boolean;
  /** Tail of the phase's output; the whole log is never kept. */
  log: string;
}

export interface JobRecord {
  id: string;
  startedAt: number;
  durationMs: number;
  ok: boolean;
  /** Set when the job could not run at all, as opposed to running and failing. */
  error?: string;
  fileCount: number;
  distFileCount: number | null;
  phases: PhaseRecord[];
}

let jobs: JobRecord[] = [];
let loaded = false;

function tail(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (t.length <= max) return t;
  return `…\n${t.slice(t.length - max)}`;
}

/** Read history from disk once. A missing or corrupt file is not an error —
 *  monitoring must never be the reason the service will not start. */
export function loadHistory(): void {
  if (loaded) return;
  loaded = true;
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_FILE, "utf8")) as unknown;
    // Pruned on read too, so an old file shrinks even if nothing new is built.
    if (Array.isArray(parsed)) jobs = prune(parsed as JobRecord[]);
  } catch {
    jobs = [];
  }
}

function persist(): void {
  try {
    mkdirSync(dirname(HISTORY_FILE), { recursive: true });
    // Write beside the target and rename: a rename is atomic, so a crash
    // mid-write leaves the previous history intact rather than a half file.
    const tmp = `${HISTORY_FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(jobs), "utf8");
    renameSync(tmp, HISTORY_FILE);
  } catch {
    // Losing history is not worth failing a build over.
  }
}

/** Drop anything past either bound. */
function prune(list: JobRecord[]): JobRecord[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  const fresh = list.filter((j) => j.startedAt >= cutoff);
  return fresh.length > MAX_JOBS ? fresh.slice(-MAX_JOBS) : fresh;
}

export function recordJob(job: JobRecord): void {
  loadHistory();
  jobs.push({
    ...job,
    phases: job.phases.map((p) => ({
      ...p,
      log: tail(p.log, p.ok ? PASS_LOG_CHARS : FAIL_LOG_CHARS),
    })),
  });
  jobs = prune(jobs);
  persist();
}

/** Most recent first, which is the order anyone reads them in. */
export function recentJobs(limit = 50): JobRecord[] {
  loadHistory();
  return jobs.slice(-limit).reverse();
}

export interface HistoryStats {
  total: number;
  ok: number;
  failed: number;
  /** Median wall-clock across completed jobs, in ms. Median rather than mean:
   *  one timed-out job would drag an average somewhere useless. */
  medianMs: number | null;
  lastAt: number | null;
}

export function historyStats(): HistoryStats {
  loadHistory();
  const durations = jobs.map((j) => j.durationMs).sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return {
    total: jobs.length,
    ok: jobs.filter((j) => j.ok).length,
    failed: jobs.filter((j) => !j.ok).length,
    medianMs: durations.length ? durations[mid] : null,
    lastAt: jobs.length ? jobs[jobs.length - 1].startedAt : null,
  };
}

/** Only for tests. */
export function resetHistory(): void {
  jobs = [];
  loaded = true;
}
