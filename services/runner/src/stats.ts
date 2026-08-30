// Everything the dashboard shows, gathered in one place.
//
// Cheap by design: this is polled every few seconds, so nothing here may shell
// out to docker or block. Reading /proc and a statfs costs microseconds; a
// `docker stats` call costs seconds and would make the page slower than the
// builds it is watching.

import { statfs } from "node:fs";
import { cpus, loadavg, totalmem, freemem, uptime as osUptime } from "node:os";
import { promisify } from "node:util";
import { historyStats, recentJobs, type HistoryStats, type JobRecord } from "./history";
import { queueDepth, MAX_CONCURRENT, MAX_QUEUED, RATE_LIMIT, RATE_WINDOW_MS } from "./gate";
import { LIMITS } from "./limits";

const statfsAsync = promisify(statfs);

export interface HostStats {
  memUsedBytes: number;
  memTotalBytes: number;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  load1: number;
  load5: number;
  load15: number;
  cpuCount: number;
  osUptimeSec: number;
}

export interface Snapshot {
  now: number;
  runner: {
    image: string;
    runtime: string;
    runtimeAvailable: boolean;
    docker: boolean;
    uptimeSec: number;
    active: number;
    queued: number;
    maxConcurrent: number;
    maxQueued: number;
    rateLimit: number;
    rateWindowMs: number;
    installTimeoutMs: number;
    phaseTimeoutMs: number;
    jobTimeoutMs: number;
  };
  host: HostStats;
  history: HistoryStats;
  jobs: JobRecord[];
}

const startedAt = Date.now();

async function diskFor(path: string): Promise<{ free: number; total: number } | null> {
  try {
    const s = await statfsAsync(path);
    return { free: s.bsize * s.bavail, total: s.bsize * s.blocks };
  } catch {
    return null;
  }
}

export async function snapshot(opts: {
  image: string;
  runtime: string;
  runtimeAvailable: boolean;
  docker: boolean;
  jobLimit?: number;
}): Promise<Snapshot> {
  const [one, five, fifteen] = loadavg();
  const disk = await diskFor("/");
  const depth = queueDepth();

  return {
    now: Date.now(),
    runner: {
      image: opts.image,
      runtime: opts.runtime,
      runtimeAvailable: opts.runtimeAvailable,
      docker: opts.docker,
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      active: depth.active,
      queued: depth.queued,
      maxConcurrent: MAX_CONCURRENT,
      maxQueued: MAX_QUEUED,
      rateLimit: RATE_LIMIT,
      rateWindowMs: RATE_WINDOW_MS,
      installTimeoutMs: LIMITS.installTimeoutMs,
      phaseTimeoutMs: LIMITS.phaseTimeoutMs,
      jobTimeoutMs: LIMITS.jobTimeoutMs,
    },
    host: {
      memUsedBytes: totalmem() - freemem(),
      memTotalBytes: totalmem(),
      diskFreeBytes: disk?.free ?? null,
      diskTotalBytes: disk?.total ?? null,
      load1: one,
      load5: five,
      load15: fifteen,
      cpuCount: cpus().length,
      osUptimeSec: Math.floor(osUptime()),
    },
    history: historyStats(),
    jobs: recentJobs(opts.jobLimit ?? 25),
  };
}
