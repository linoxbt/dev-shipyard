import { describe, expect, it } from "bun:test";
import {
  ACTIVITIES,
  Tally,
  activityPoints,
  builderPoints,
  rankBuilders,
  tierForPoints,
} from "./leaderboard";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";
const D = "0x4444444444444444444444444444444444444444";

describe("the formula", () => {
  it("gives the first of anything its full weight, with diminishing returns after", () => {
    expect(activityPoints(10, 0)).toBe(0);
    expect(activityPoints(10, 1)).toBe(10);
    expect(activityPoints(10, 3)).toBe(20);
    expect(activityPoints(10, 7)).toBe(30);
  });

  it("rewards range over repeating one thing", () => {
    const volume = builderPoints({ contracts: 20 });
    const range = builderPoints({ contracts: 3, apps: 1, listings: 1, sales: 1 });
    expect(range).toBeGreaterThan(volume);
  });

  it("weighs what others choose above what a builder does alone", () => {
    const weight = (key: string) => ACTIVITIES.find((a) => a.key === key)!.weight;
    expect(weight("sales")).toBeGreaterThan(weight("contracts"));
    expect(weight("sales")).toBeGreaterThan(weight("listings"));
  });

  it("sets tiers by points", () => {
    expect(tierForPoints(0)).toBe("newcomer");
    expect(tierForPoints(20)).toBe("builder");
    expect(tierForPoints(60)).toBe("regular");
    expect(tierForPoints(120)).toBe("veteran");
  });
});

describe("ranking", () => {
  it("orders by points, ties share a rank, and the next entry skips", () => {
    const rows = rankBuilders({
      [A]: { contracts: 1 },
      [B]: { contracts: 1 },
      [C]: { apps: 1, sales: 3 },
      [D]: { tips: 1 },
    });
    expect(rows.map((r) => r.address)).toEqual([C, A, B, D]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
    expect(rows[0]).toMatchObject({ points: 42, counts: { apps: 1, sales: 3, contracts: 0 } });
  });

  it("leaves out bad addresses and builders with nothing counted, and honours the limit", () => {
    expect(rankBuilders({ "not-an-address": { contracts: 5 }, [A]: {} })).toEqual([]);
    const many: Record<string, { contracts: number }> = {};
    for (let i = 1; i <= 30; i++) many[`0x${String(i).padStart(40, "0")}`] = { contracts: i };
    expect(rankBuilders(many, 10)).toHaveLength(10);
  });
});

describe("tallying", () => {
  it("adds up per address, case-insensitively, and ignores what cannot count", () => {
    const tally = new Tally();
    tally.add(A, "sales");
    tally.add(A.toUpperCase().replace("0X", "0x"), "sales", 2);
    tally.add(A, "clones", 0);
    tally.add("nope", "apps");
    expect(tally.counts()[A]).toMatchObject({ sales: 3, clones: 0 });
    expect(Object.keys(tally.counts())).toEqual([A]);
  });
});
