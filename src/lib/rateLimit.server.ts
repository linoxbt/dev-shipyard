// Sliding-window rate limiter for server routes that proxy a paid/abusable
// upstream (AI provider keys, sponsor wallet gas, the operator's runner).
//
// Two backends:
//
// - Shared (Upstash Redis over REST), when UPSTASH_REDIS_REST_URL and
//   UPSTASH_REDIS_REST_TOKEN are set. One counter per key across every
//   serverless instance, so the configured limit is the real limit. This is
//   the one to run in production.
// - In memory otherwise. On a serverless host each instance keeps its OWN
//   map, so the effective limit is (configured limit x live instances) and it
//   resets whenever an instance is recycled. Friction, not a boundary; a
//   warning says so once.
//
// The client key used to be the FIRST X-Forwarded-For entry, which is whatever
// the client wrote: one header per request and every per-IP limit was gone.
// clientKeyFromRequest now prefers the header the platform itself sets.

interface Bucket {
  hits: number[]; // request timestamps (ms) within the current window
}

const buckets = new Map<string, Bucket>();

// Bound memory. Eviction is least-recently-USED (a hit re-inserts the key at
// the end of the map), and keys ending in ":global" are never evicted: those
// are the caps on total spend, and evicting the oldest-created key used to
// mean that rotating client keys reset exactly them.
const MAX_TRACKED_KEYS = 5000;

function prune(bucket: Bucket, windowMs: number, now: number) {
  while (bucket.hits.length > 0 && now - bucket.hits[0] > windowMs) {
    bucket.hits.shift();
  }
}

function evictOne() {
  for (const key of buckets.keys()) {
    if (key.endsWith(":global")) continue;
    buckets.delete(key);
    return;
  }
}

/** The in-memory backend, exported for tests. */
export function checkMemoryLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  let bucket = buckets.get(key);
  if (bucket) {
    buckets.delete(key);
  } else {
    if (buckets.size >= MAX_TRACKED_KEYS) evictOne();
    bucket = { hits: [] };
  }
  buckets.set(key, bucket);
  prune(bucket, windowMs, now);
  if (bucket.hits.length >= limit) return false;
  bucket.hits.push(now);
  return true;
}

/** For tests. */
export function resetMemoryLimits(): void {
  buckets.clear();
}

function sharedStore(): { url: string; token: string } | null {
  const url = (process.env.UPSTASH_REDIS_REST_URL ?? "").replace(/\/+$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";
  return url && token ? { url, token } : null;
}

let warnedMemory = false;

/**
 * Fixed-window counter in Redis: INCR the window's key, set its expiry on the
 * first hit. Coarser than the sliding window in memory, but atomic and shared.
 * Returns null when the store cannot be reached, so the caller can fall back.
 */
async function checkSharedLimit(
  store: { url: string; token: string },
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean | null> {
  const window = Math.floor(Date.now() / windowMs);
  const redisKey = `rl:${key}:${window}`;
  try {
    const res = await fetch(`${store.url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
      body: JSON.stringify([
        ["INCR", redisKey],
        ["PEXPIRE", redisKey, String(windowMs), "NX"],
      ]),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as Array<{ result?: unknown }>;
    const count = Number(out?.[0]?.result);
    if (!Number.isFinite(count)) return null;
    return count <= limit;
  } catch {
    return null;
  }
}

/**
 * Returns true if `key` is allowed to proceed under `limit` requests per
 * `windowMs`, recording this call as a hit when allowed.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const store = sharedStore();
  if (store) {
    const shared = await checkSharedLimit(store, key, limit, windowMs);
    if (shared !== null) return shared;
    // An unreachable store falls back to memory rather than failing every
    // request: the limits get weaker for a moment, the site stays up.
  } else if (!warnedMemory) {
    warnedMemory = true;
    console.warn(
      "[devstation] Rate limits are per-instance (in memory). Set UPSTASH_REDIS_REST_URL and " +
        "UPSTASH_REDIS_REST_TOKEN for limits that hold across serverless instances.",
    );
  }
  return checkMemoryLimit(key, limit, windowMs);
}

const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

/**
 * The client's address, from the header the hosting platform sets rather than
 * one the client can write.
 *
 * Order: Netlify's x-nf-client-connection-ip, Vercel's
 * x-vercel-forwarded-for, x-real-ip, then the RIGHTMOST X-Forwarded-For entry
 * (the one the nearest proxy appended). The leftmost entry is client-supplied
 * and is never used.
 */
export function clientKeyFromRequest(request: Request): string {
  const h = request.headers;
  for (const name of ["x-nf-client-connection-ip", "x-vercel-forwarded-for", "x-real-ip"]) {
    const v = h.get(name)?.split(",")[0]?.trim();
    if (v && IP_LIKE.test(v)) return v;
  }
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && IP_LIKE.test(last)) return last;
  }
  return "unknown";
}
