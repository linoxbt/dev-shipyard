import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Marketplace activity that leaves no trace on chain: an app or UI kit cloned
// into the App Builder, a skill or kit downloaded. Sales, deploys and tips are
// on chain and counted from there; these are counted here, by DevStation, and
// the marketplace says so.
//
// One count per person, per listing, per action, per day. Refreshing a page or
// pressing Download ten times is one download, so the numbers mean people.

export type ActivityAction = "clone" | "download";

export interface ListingActivity {
  clone: number;
  download: number;
}

/** b-<slug> built-in, m-<n> marketplace, t-<n> template registry. */
const LISTING_ID = /^(?:b-[a-z0-9-]{1,80}|m-\d{1,9}|t-\d{1,9})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Past this many remembered visitors, the ones older than a day are dropped. */
const MAX_SEEN = 100_000;

export function activityFile(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.ACTIVITY_FILE ??
    join(env.STATE_DIRECTORY ?? "/var/lib/devstation-runner", "marketplace-activity.json")
  );
}

export class ActivityStore {
  private readonly counts = new Map<string, ListingActivity>();
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as {
        counts?: Record<string, Partial<ListingActivity>>;
      };
      for (const [id, entry] of Object.entries(saved.counts ?? {})) {
        if (!LISTING_ID.test(id)) continue;
        this.counts.set(id, {
          clone: Number(entry.clone) || 0,
          download: Number(entry.download) || 0,
        });
      }
    } catch {
      // A damaged file starts the counts again rather than taking the runner down.
    }
  }

  /**
   * Counts one action by `who` (a wallet, or failing that a client address).
   * True when counted; false when this person was already counted for it
   * today; null when the listing or the action is not one that exists.
   */
  record(listing: string, action: string, who: string): boolean | null {
    if (!LISTING_ID.test(listing) || (action !== "clone" && action !== "download")) return null;
    const key = `${listing}|${action}|${who.toLowerCase()}`;
    const now = this.now();
    const last = this.seen.get(key);
    if (last !== undefined && now - last < DAY_MS) return false;
    this.seen.set(key, now);
    if (this.seen.size > MAX_SEEN) this.prune(now);

    const entry = this.counts.get(listing) ?? { clone: 0, download: 0 };
    entry[action as ActivityAction] += 1;
    this.counts.set(listing, entry);
    this.save();
    return true;
  }

  all(): Record<string, ListingActivity> {
    return Object.fromEntries([...this.counts].map(([id, entry]) => [id, { ...entry }]));
  }

  private prune(now: number): void {
    for (const [key, at] of this.seen) if (now - at >= DAY_MS) this.seen.delete(key);
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const partial = `${this.file}.tmp`;
      writeFileSync(partial, JSON.stringify({ counts: this.all() }));
      renameSync(partial, this.file);
    } catch {
      // The counts stay in memory; the next successful write catches up.
    }
  }
}
