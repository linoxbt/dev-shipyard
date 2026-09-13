// A builder's activity over time: the contribution heatmap and the timeline.
//
// Pure functions over timestamps and events that were read from chain or from
// the builder's own stored work, so every square on the heatmap is something
// that actually happened on that day.

export type ActivityKind =
  | "deploy"
  | "listing"
  | "sale"
  | "deploy-sale"
  | "tip"
  | "purchase"
  | "label"
  | "app"
  | "tx";

export interface ActivityEvent {
  kind: ActivityKind;
  /** Milliseconds. */
  at: number;
  title: string;
  detail?: string;
  /** In-app route or external URL. */
  href?: string;
  external?: boolean;
  chainId?: number;
  /** Stable identity for de-duplication, e.g. a transaction hash. */
  key?: string;
}

const DAY = 86_400_000;

/** UTC midnight of the day containing `ms`. */
export function dayStart(ms: number): number {
  return Math.floor(ms / DAY) * DAY;
}

export interface HeatmapDay {
  /** UTC midnight, ms. */
  date: number;
  count: number;
  /** 0 for none, 1-4 by share of the busiest day. */
  level: 0 | 1 | 2 | 3 | 4;
  /** False for the padding days after today in the last column. */
  inRange: boolean;
}

export interface Heatmap {
  /** Columns of seven days, Sunday first, oldest column first. */
  weeks: HeatmapDay[][];
  total: number;
  activeDays: number;
  busiestDay: { date: number; count: number } | null;
  longestStreak: number;
  currentStreak: number;
}

/**
 * Bucket activity timestamps into a year of days.
 *
 * Streaks count consecutive active days; the current streak may end today or
 * yesterday, so a builder who has not shipped yet today keeps their streak
 * until the day is over.
 */
export function buildHeatmap(timestamps: number[], now = Date.now(), weeks = 53): Heatmap {
  const today = dayStart(now);
  const counts = new Map<number, number>();
  for (const t of timestamps) {
    if (!Number.isFinite(t) || t <= 0 || t > now + DAY) continue;
    const d = dayStart(t);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  // The grid ends on the Saturday of this week and starts `weeks` columns back.
  const todayDow = new Date(today).getUTCDay();
  const gridEnd = today + (6 - todayDow) * DAY;
  const gridStart = gridEnd - (weeks * 7 - 1) * DAY;

  let max = 0;
  for (let d = gridStart; d <= today; d += DAY) max = Math.max(max, counts.get(d) ?? 0);

  const levelOf = (n: number): HeatmapDay["level"] => {
    if (n <= 0 || max === 0) return 0;
    const share = n / max;
    return share > 0.75 ? 4 : share > 0.5 ? 3 : share > 0.25 ? 2 : 1;
  };

  const columns: HeatmapDay[][] = [];
  let total = 0;
  let activeDays = 0;
  let busiest: Heatmap["busiestDay"] = null;
  for (let w = 0; w < weeks; w++) {
    const column: HeatmapDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = gridStart + (w * 7 + i) * DAY;
      const inRange = date <= today;
      const count = inRange ? (counts.get(date) ?? 0) : 0;
      if (count > 0) {
        total += count;
        activeDays++;
        if (!busiest || count > busiest.count) busiest = { date, count };
      }
      column.push({ date, count, level: levelOf(count), inRange });
    }
    columns.push(column);
  }

  // Streaks over every recorded day, not just the visible year.
  const days = [...counts.keys()].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous: number | null = null;
  for (const d of days) {
    run = previous !== null && d - previous === DAY ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = d;
  }
  let current = 0;
  let cursor = counts.has(today) ? today : today - DAY;
  while (counts.has(cursor)) {
    current++;
    cursor -= DAY;
  }

  return {
    weeks: columns,
    total,
    activeDays,
    busiestDay: busiest,
    longestStreak: longest,
    currentStreak: current,
  };
}

/** Newest first, one entry per underlying fact. */
export function mergeTimeline(events: ActivityEvent[], limit = 50): ActivityEvent[] {
  const seen = new Set<string>();
  const out: ActivityEvent[] = [];
  for (const e of [...events].sort((a, b) => b.at - a.at)) {
    if (!Number.isFinite(e.at) || e.at <= 0) continue;
    const id = `${e.kind}:${e.key ?? `${e.at}:${e.title}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}
