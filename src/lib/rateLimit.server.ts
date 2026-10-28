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
  // An unreachable store falls back to the next one, and finally to memory,
  // rather than failing every request: the limits get weaker for a moment,
  // the site stays up.
  const upstash = sharedStore();
  if (upstash) {
    const shared = await checkSharedLimit(upstash, key, limit, windowMs);
    if (shared !== null) return shared;
  }
  const runner = runnerStore();
  if (runner) {
    const shared = await checkRunnerLimit(runner, key, limit, windowMs);
    if (shared !== null) return shared;
  }
  if (!upstash && !runner && !warnedMemory) {
    warnedMemory = true;
    console.warn(
      "[devstation] Rate limits are per-instance (in memory). Configure the runner " +
        "(RUNNER_URL, RUNNER_TOKEN) or Upstash for limits that hold across serverless instances.",
    );
  }
  return checkMemoryLimit(key, limit, windowMs);
}

/** The runner, when the app is configured to use it: one long-lived process
 *  every function instance already reaches, so its counters are shared. */
function runnerStore(): { url: string; token: string } | null {
  const url = (process.env.RUNNER_URL ?? "").replace(/\/+$/, "");
  const token = process.env.RUNNER_TOKEN ?? "";
  return url && token ? { url, token } : null;
}

async function checkRunnerLimit(
  store: { url: string; token: string },
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean | null> {
  try {
    const res = await fetch(`${store.url}/limits/hit`, {
      method: "POST",
      headers: { authorization: `Bearer ${store.token}`, "content-type": "application/json" },
      body: JSON.stringify({ key, limit, windowMs }),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const out = (await res.json()) as { allowed?: unknown };
    return typeof out.allowed === "boolean" ? out.allowed : null;
  } catch {
    return null;
  }
}

const IP_LIKE = /^[0-9a-fA-F:.]{2,45}$/;

/** The one header this deployment's platform sets and a client cannot. Any
 *  other "client IP" header can be written by the client itself, so only this
 *  one is read. TRUSTED_IP_HEADER overrides it for other hosts (for example
 *  `x-real-ip` behind an nginx that sets it, or `cf-connecting-ip`). */
export function trustedIpHeader(env: NodeJS.ProcessEnv = process.env): string | null {
  const configured = env.TRUSTED_IP_HEADER?.trim().toLowerCase();
  if (configured) return configured === "x-forwarded-for" ? null : configured;
  if (env.VERCEL) return "x-vercel-forwarded-for";
  // Netlify's edge overwrites this header on every request, so it is trusted
  // only when the code is really running there (Netlify exposes SITE_ID and
  // DEPLOY_ID to functions). Anywhere else a client could set it.
  if (env.NETLIFY || (env.SITE_ID && env.DEPLOY_ID)) return "x-nf-client-connection-ip";
  return null;
}

/**
 * The client's address, from the header the hosting platform sets rather than
 * one the client can write: the platform's own header (see trustedIpHeader),
 * else the RIGHTMOST X-Forwarded-For entry, the one the nearest proxy
 * appended. The leftmost entry is client-supplied and is never used. Behind a
 * proxy that sets none of these, every client shares one key: set
 * TRUSTED_IP_HEADER (see DEPLOYMENT.md).
 */
export function clientKeyFromRequest(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const h = request.headers;
  const name = trustedIpHeader(env);
  if (name) {
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
