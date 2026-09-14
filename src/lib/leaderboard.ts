import type { Tier } from "@/lib/reputation";

// The builder leaderboard's formula.
//
// A builder is more than the contracts they deploy: they publish apps, list
// work on the marketplace, and other people buy it, deploy it, tip it and clone
// it. Every one of those counts here, and each is scored with diminishing
// returns:
//
//   points = Σ weight × log₂(1 + count)
//
// The first of anything is worth its full weight, the third twice that, the
// seventh three times. Ten contracts are worth more than one, but less than a
// contract, an app, a listing and a sale, so the way up the board is range as
// well as volume, and nobody tops it by repeating one cheap action.
//
// Kept pure: the server gathers the counts (profile.functions.ts), this ranks
// them, and the page shows this same table so the formula is never a secret.

export type Activity = "contracts" | "apps" | "listings" | "sales" | "deploys" | "tips" | "clones";

export interface ActivityInfo {
  key: Activity;
  /** Column heading. */
  label: string;
  weight: number;
  /** What one unit of this activity is. */
  counts: string;
  /** Where the number comes from: the chain, or DevStation's own records. */
  source: "chain" | "devstation";
}

export const ACTIVITIES: readonly ActivityInfo[] = [
  {
    key: "contracts",
    label: "Contracts",
    weight: 10,
    counts: "A contract deployed through DevStation and recorded in its registry",
    source: "chain",
  },
  {
    key: "apps",
    label: "Apps",
    weight: 12,
    counts: "An app published to its own devstation.online address",
    source: "devstation",
  },
  {
    key: "listings",
    label: "Listings",
    weight: 12,
    counts: "An active marketplace listing: a template, app, skill or UI kit",
    source: "chain",
  },
  {
    key: "sales",
    label: "Sales",
    weight: 15,
    counts: "A purchase of one of their listings by someone else",
    source: "chain",
  },
  {
    key: "deploys",
    label: "Deploys",
    weight: 12,
    counts: "A deploy of one of their contract templates",
    source: "chain",
  },
  {
    key: "tips",
    label: "Tips",
    weight: 8,
    counts: "A tip on one of their listings from someone else",
    source: "chain",
  },
  {
    key: "clones",
    label: "Clones",
    weight: 6,
    counts: "A clone or download of one of their listings, once per person a day",
    source: "devstation",
  },
];

export type ActivityCounts = Record<Activity, number>;

export function emptyCounts(): ActivityCounts {
  return { contracts: 0, apps: 0, listings: 0, sales: 0, deploys: 0, tips: 0, clones: 0 };
}

/** What `count` of an activity with `weight` is worth. */
export function activityPoints(weight: number, count: number): number {
  return count > 0 ? weight * Math.log2(1 + count) : 0;
}

/** Points per activity, unrounded. */
export function scoreBreakdown(counts: Partial<ActivityCounts>): ActivityCounts {
  const out = emptyCounts();
  for (const activity of ACTIVITIES) {
    out[activity.key] = activityPoints(activity.weight, counts[activity.key] ?? 0);
  }
  return out;
}

/** A builder's points, as shown: a whole number. */
export function builderPoints(counts: Partial<ActivityCounts>): number {
  return Math.round(Object.values(scoreBreakdown(counts)).reduce((sum, p) => sum + p, 0));
}

const POINT_TIERS: ReadonlyArray<{ tier: Tier; min: number }> = [
  { tier: "veteran", min: 120 },
  { tier: "regular", min: 60 },
  { tier: "builder", min: 20 },
  { tier: "newcomer", min: 0 },
];

export function tierForPoints(points: number): Tier {
  return POINT_TIERS.find((t) => points >= t.min)?.tier ?? "newcomer";
}

export interface BoardEntry {
  address: string;
  counts: ActivityCounts;
  points: number;
  tier: Tier;
  /** 1-based, and shared by ties: two builders on 42 points are both 3rd,
   *  and the next is 5th. */
  rank: number;
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

/** Ranks builders by points. Addresses with nothing counted are left out. */
export function rankBuilders(
  byAddress: Record<string, Partial<ActivityCounts>>,
  limit = 50,
): BoardEntry[] {
  const rows = Object.entries(byAddress)
    .filter(([address]) => ADDRESS.test(address))
    .map(([address, partial]) => {
      const counts = { ...emptyCounts(), ...partial };
      return { address: address.toLowerCase(), counts, points: builderPoints(counts) };
    })
    .filter((row) => row.points > 0)
    // Address breaks ties for ORDER only, so the list is stable between renders;
    // the rank number still ties.
    .sort((a, b) => b.points - a.points || a.address.localeCompare(b.address));

  let rank = 0;
  let previous: number | null = null;
  return rows.slice(0, limit).map((row, i) => {
    if (previous === null || row.points < previous) {
      rank = i + 1;
      previous = row.points;
    }
    return { ...row, tier: tierForPoints(row.points), rank };
  });
}

/** Counts activity per address while the sources are read. */
export class Tally {
  private readonly rows = new Map<string, ActivityCounts>();

  add(address: string, activity: Activity, count = 1): void {
    if (!ADDRESS.test(address) || !(count > 0)) return;
    const key = address.toLowerCase();
    const row = this.rows.get(key) ?? emptyCounts();
    row[activity] += count;
    this.rows.set(key, row);
  }

  counts(): Record<string, ActivityCounts> {
    return Object.fromEntries(this.rows);
  }
}
