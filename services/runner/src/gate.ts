// Who may run a job, how often, and how many at a time.
//
// These matter because the runner is reachable from the internet. DevStation's
// /api/build has its own limits, but they protect nothing here: a caller
// holding the token talks to this service directly and never passes through
// them. So the ceilings have to exist on this side too.

import { timingSafeEqual } from "node:crypto";

/** Jobs running at once. One, deliberately: a job may use a gigabyte, and this
 *  host has about three free while running everything else it runs. Two would
 *  be tight; three would start killing things that have nothing to do with
 *  DevStation. */
export const MAX_CONCURRENT = 1;
/** Callers waiting for a slot. Beyond this they are turned away immediately
 *  rather than left holding a connection open for several minutes. */
export const MAX_QUEUED = 4;
/** Jobs per token per window. A build is a whole CPU for a minute or two, so
 *  this is generous for a person and restrictive for a script. */
export const RATE_LIMIT = 30;
/** Ceiling across every caller, so many distinct clients cannot swamp a host
 *  that runs one job at a time. Generous next to the per-caller limit: this is
 *  a backstop, not the primary control. */
export const RATE_LIMIT_GLOBAL = 200;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

/** Constant-time bearer comparison.
 *
 *  `!==` on a secret leaks its length and, in principle, its prefix through
 *  timing. The cost of doing it properly is a few microseconds. */
export function tokenMatches(header: string | undefined, expected: string): boolean {
  if (!expected || !header) return false;
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;
  const given = Buffer.from(header.slice(prefix.length));
  const want = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal; compare against a padded copy and fold the length in.
  if (given.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(given, want);
}

const hits = new Map<string, number[]>();

/** Sliding-window counter. In-memory, so it resets on restart and does not
 *  span replicas: this is one process on one box, and the failure it exists
 *  to stop is a loop, not a botnet. */
export function withinRateLimit(
  key: string,
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS,
): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

/** Only for tests. */
export function resetRateLimit(): void {
  hits.clear();
}

let active = 0;
let queued = 0;

export function queueDepth(): { active: number; queued: number } {
  return { active, queued };
}

/**
 * Run `fn` with at most MAX_CONCURRENT others in flight.
 *
 * Returns null immediately when the queue is already full, so an overloaded
 * runner says so rather than accepting work it cannot get to.
 */
export async function withSlot<T>(fn: () => Promise<T>): Promise<T | null> {
  if (active >= MAX_CONCURRENT && queued >= MAX_QUEUED) return null;

  queued++;
  try {
    while (active >= MAX_CONCURRENT) {
      await new Promise((r) => setTimeout(r, 250));
    }
  } finally {
    queued--;
  }

  active++;
  try {
    return await fn();
  } finally {
    active--;
  }
}
