// Reading and recording what DevStation counts itself: clones and downloads of
// marketplace listings, and how many apps each wallet has published. Both live
// on the runner (services/runner/src/activity.ts and publish.ts), which this
// server reaches with its bearer token. Never imported by the browser.

export interface ListingActivity {
  clone: number;
  download: number;
}

function runner(): { url: string; token: string } | null {
  const url = (process.env.RUNNER_URL ?? "").replace(/\/+$/, "");
  const token = process.env.RUNNER_TOKEN ?? "";
  return url && token ? { url, token } : null;
}

const CACHE_MS = 30_000;
const cache = new Map<string, { at: number; value: unknown }>();

/** GETs a runner path, cached briefly: every marketplace page and the
 *  leaderboard read these, and the numbers do not need to be to-the-second. */
async function cachedGet<T>(path: string): Promise<T | null> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T | null;
  const cfg = runner();
  if (!cfg) return null;
  let value: T | null = null;
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      headers: { authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { ok?: boolean; counts?: T };
    value = res.ok && body.ok && body.counts ? body.counts : null;
  } catch {
    value = null;
  }
  cache.set(path, { at: Date.now(), value });
  return value;
}

/** Clones and downloads per listing id (b-…, m-…, t-…), or null when the
 *  runner cannot be reached. */
export function readListingActivity(): Promise<Record<string, ListingActivity> | null> {
  return cachedGet<Record<string, ListingActivity>>("/marketplace/activity");
}

/** Published apps per lowercased wallet, or null when the runner cannot be reached. */
export function readPublishedAppCounts(): Promise<Record<string, number> | null> {
  return cachedGet<Record<string, number>>("/published-counts");
}

export async function recordListingActivity(input: {
  listing: string;
  action: "clone" | "download";
  caller: string;
  wallet: string | null;
}): Promise<{ ok: boolean; counted: boolean }> {
  const cfg = runner();
  if (!cfg) return { ok: false, counted: false };
  try {
    const res = await fetch(`${cfg.url}/marketplace/activity`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json",
        "x-devstation-caller": input.caller.slice(0, 100),
      },
      body: JSON.stringify({ listing: input.listing, action: input.action, wallet: input.wallet }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { ok?: boolean; counted?: boolean };
    if (body.counted) cache.delete("/marketplace/activity");
    return { ok: res.ok && body.ok === true, counted: body.counted === true };
  } catch {
    return { ok: false, counted: false };
  }
}
