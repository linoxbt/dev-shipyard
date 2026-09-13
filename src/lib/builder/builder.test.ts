import { describe, expect, it } from "bun:test";
import { buildHeatmap, dayStart, mergeTimeline } from "./activity";
import { achievementsFor, tierProgress, type BuilderFacts } from "./achievements";

const DAY = 86_400_000;
// A Wednesday, 2026-09-16 12:00 UTC.
const NOW = Date.UTC(2026, 8, 16, 12);

describe("heatmap", () => {
  it("counts activity per day and grades it against the busiest day", () => {
    const h = buildHeatmap([NOW, NOW - 1000, NOW - DAY, NOW - 40 * DAY], NOW);
    expect(h.total).toBe(4);
    expect(h.activeDays).toBe(3);
    expect(h.busiestDay?.count).toBe(2);
    const today = h.weeks.flat().find((d) => d.date === dayStart(NOW))!;
    expect(today.count).toBe(2);
    expect(today.level).toBe(4);
  });

  it("lays out full weeks, Sunday first, ending this week", () => {
    const h = buildHeatmap([], NOW, 53);
    expect(h.weeks).toHaveLength(53);
    expect(h.weeks.every((w) => w.length === 7)).toBe(true);
    expect(new Date(h.weeks[0][0].date).getUTCDay()).toBe(0);
    // Days after today in the last column are padding, never counted.
    expect(h.weeks.at(-1)!.filter((d) => !d.inRange)).toHaveLength(3);
  });

  it("measures streaks, keeping today's streak alive until the day ends", () => {
    const days = [0, 1, 2].map((n) => NOW - (n + 1) * DAY); // yesterday and the two before
    const h = buildHeatmap([...days, NOW - 10 * DAY, NOW - 11 * DAY], NOW);
    expect(h.currentStreak).toBe(3);
    expect(h.longestStreak).toBe(3);
    expect(buildHeatmap([NOW - 3 * DAY], NOW).currentStreak).toBe(0);
  });

  it("ignores timestamps that are missing or in the future", () => {
    expect(buildHeatmap([0, NaN, NOW + 5 * DAY], NOW).total).toBe(0);
  });
});

describe("timeline", () => {
  it("is newest first and lists each fact once", () => {
    const out = mergeTimeline([
      { kind: "deploy", at: 1, title: "A", key: "0x1" },
      { kind: "deploy", at: 3, title: "B", key: "0x2" },
      { kind: "deploy", at: 3, title: "B again", key: "0x2" },
      { kind: "sale", at: 2, title: "C", key: "0x2" },
    ]);
    expect(out.map((e) => e.title)).toEqual(["B", "C", "A"]);
  });
});

const none: BuilderFacts = {
  deployments: 0,
  verified: 0,
  networks: 0,
  templatesUsed: 0,
  templateDeploys: 0,
  listings: 0,
  sales: 0,
  paidDeploys: 0,
  tipsReceived: 0,
  appsBuilt: 0,
  appsPublished: 0,
  labels: 0,
  qieNames: 0,
  walletAgeDays: null,
  longestStreak: 0,
  leaderboardRank: null,
};

describe("achievements", () => {
  it("awards nothing to a wallet that has done nothing", () => {
    expect(achievementsFor(none).filter((a) => a.earned)).toEqual([]);
  });

  it("awards from facts, and shows progress toward the rest", () => {
    const list = achievementsFor({
      ...none,
      deployments: 4,
      qieNames: 1,
      sales: 1,
      leaderboardRank: 7,
    });
    const byId = Object.fromEntries(list.map((a) => [a.id, a]));
    expect(byId["first-contract"].earned).toBe(true);
    expect(byId["named"].earned).toBe(true);
    expect(byId["first-sale"].earned).toBe(true);
    expect(byId["top-ten"].earned).toBe(true);
    expect(byId["shipper"].earned).toBe(false);
    expect(byId["shipper"].current).toBe(4);
    expect(byId["shipper"].target).toBe(10);
  });
});

describe("tier progress", () => {
  it("says what the next tier takes", () => {
    const p = tierProgress(5, 0);
    expect(p.tier).toBe("builder");
    expect(p.next?.tier).toBe("regular");
    expect(p.next?.needed).toBe(5);
    expect(p.progress).toBeCloseTo(2 / 7);
  });

  it("counts others deploying your work, and tops out at veteran", () => {
    expect(tierProgress(1, 2).tier).toBe("builder");
    const top = tierProgress(30, 0);
    expect(top.next).toBeNull();
    expect(top.progress).toBe(1);
  });
});
