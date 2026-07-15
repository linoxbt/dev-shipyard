// Minimal in-memory sliding-window rate limiter for server routes that proxy
// a paid/abusable upstream (AI provider keys, sponsor wallet gas). No
// database — consistent with the rest of this app's server-fn architecture —
// so this is best-effort: it resets on a cold start and doesn't share state
// across serverless instances. That's an acceptable trade for its purpose
// (blocking a naive tight-loop abuser), not a claim of hard, distributed
// rate limiting.

interface Bucket {
  hits: number[]; // request timestamps (ms) within the current window
}

const buckets = new Map<string, Bucket>();

// Bound memory: if this map somehow grows very large (many distinct IPs),
// drop the oldest-touched entries rather than growing unbounded.
const MAX_TRACKED_KEYS = 5000;

function prune(bucket: Bucket, windowMs: number, now: number) {
  while (bucket.hits.length > 0 && now - bucket.hits[0] > windowMs) {
    bucket.hits.shift();
  }
}

/**
 * Returns true if `key` is allowed to proceed under `limit` requests per
 * `windowMs`, recording this call as a hit when allowed.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  prune(bucket, windowMs, now);
  if (bucket.hits.length >= limit) return false;
  bucket.hits.push(now);
  return true;
}

/** Best-effort client identifier from standard proxy headers, falling back to a shared key. */
export function clientKeyFromRequest(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
