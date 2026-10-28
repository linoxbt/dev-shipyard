// The shared rate-limit store for DevStation's serverless functions.
//
// Every function instance on Netlify or Vercel used to keep its own counters,
// so the effective limit was the configured one times the live instances, and
// a cold start reset it. The runner is one long-lived process that every
// instance already talks to, so it holds the counters instead when no Upstash
// store is configured. Sliding window, bounded, and global keys never evicted:
// the same rules as the app's in-memory fallback (src/lib/rateLimit.server.ts).

const MAX_KEYS = 50_000;

export class RateStore {
  private readonly buckets = new Map<string, number[]>();

  /** Records a hit and says whether it is within `limit` per `windowMs`. */
  hit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    let hits = this.buckets.get(key);
    if (hits) {
      this.buckets.delete(key); // re-insert: Map order is recency
    } else {
      if (this.buckets.size >= MAX_KEYS) this.evictOne();
      hits = [];
    }
    this.buckets.set(key, hits);
    while (hits.length > 0 && now - hits[0] > windowMs) hits.shift();
    if (hits.length >= limit) return false;
    hits.push(now);
    return true;
  }

  get size(): number {
    return this.buckets.size;
  }

  private evictOne() {
    for (const key of this.buckets.keys()) {
      if (key.endsWith(":global")) continue;
      this.buckets.delete(key);
      return;
    }
  }
}

/** A hit request as the app sends it, or why it is not one. */
export function parseHit(
  body: unknown,
): { key: string; limit: number; windowMs: number } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const key = typeof b.key === "string" ? b.key : "";
  const limit = Number(b.limit);
  const windowMs = Number(b.windowMs);
  if (!key || key.length > 300) return { error: "key" };
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000_000) return { error: "limit" };
  if (!Number.isInteger(windowMs) || windowMs < 1_000 || windowMs > 7 * 86_400_000) {
    return { error: "windowMs" };
  }
  return { key, limit, windowMs };
}
