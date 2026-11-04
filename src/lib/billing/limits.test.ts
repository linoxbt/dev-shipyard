import { describe, expect, it } from "bun:test";
import {
  effectiveLimits,
  limitProblem,
  turnKey,
  type AccountLimits,
  type UsageSettings,
} from "./limits.server";

const settings: UsageSettings = {
  launchCreditUsd: 5,
  launchSlots: 20,
  freeDailyUsd: 0,
  runLimitUsd: 2,
  dailyLimitUsd: 5,
  runsPerDay: 10,
  updatedAt: null,
  updatedBy: null,
};

const own = (patch: Partial<AccountLimits> = {}): AccountLimits => ({
  owner: "0xabc",
  runLimitUsd: null,
  dailyLimitUsd: null,
  runsPerDay: null,
  freeDailyUsd: null,
  noRunLimit: false,
  noDailyLimit: false,
  noRunsLimit: false,
  paused: false,
  note: "",
  updatedAt: null,
  ...patch,
});

const free = { plan: "free" as const, unlimited: false };
const state = (patch = {}) => ({
  daySpent: 0,
  runSpent: 0,
  runsToday: 0,
  runSeen: false,
  ...patch,
});

describe("usage limits", () => {
  it("holds the free plan to the settings", () => {
    expect(effectiveLimits(free, settings, null)).toEqual({
      runLimitUsd: 2,
      dailyLimitUsd: 5,
      runsPerDay: 10,
      freeDailyUsd: 0,
      paused: false,
      custom: false,
    });
  });

  it("lets an admin set, lift or keep each limit for one account", () => {
    const l = effectiveLimits(
      free,
      settings,
      own({ runLimitUsd: 0.5, noDailyLimit: true, freeDailyUsd: 1 }),
    );
    expect(l).toMatchObject({
      runLimitUsd: 0.5,
      dailyLimitUsd: null,
      runsPerDay: 10,
      freeDailyUsd: 1,
    });
    expect(l.custom).toBe(true);
  });

  it("does not hold Pro or admin-granted accounts to the defaults, only to their own", () => {
    const unlimited = { plan: "pro" as const, unlimited: true };
    expect(effectiveLimits(unlimited, settings, null)).toMatchObject({
      runLimitUsd: null,
      dailyLimitUsd: null,
      runsPerDay: null,
      freeDailyUsd: null,
    });
    expect(effectiveLimits(unlimited, settings, own({ dailyLimitUsd: 3 })).dailyLimitUsd).toBe(3);
  });

  it("stops a run, a day, the runs of a day, and a paused account", () => {
    const l = effectiveLimits(free, settings, null);
    expect(limitProblem(l, state())).toBeNull();
    expect(limitProblem(l, state({ runSpent: 2 }))).toContain(
      "This run reached its limit of $2.00",
    );
    expect(limitProblem(l, state({ daySpent: 5.01 }))).toContain("today's limit of $5.00");
    // A new run past the day's count is refused; one already going finishes.
    expect(limitProblem(l, state({ runsToday: 10 }))).toContain("started 10 runs today");
    expect(limitProblem(l, state({ runsToday: 10, runSeen: true }))).toBeNull();
    expect(limitProblem(effectiveLimits(free, settings, own({ paused: true })), state())).toContain(
      "paused",
    );
  });

  it("names a run by its workspace and start", () => {
    expect(turnKey("ds-1~ws-2", 1700000000000)).toBe("ds-1~ws-2:1700000000000");
  });
});
