import { describe, expect, it, beforeEach } from "bun:test";
import {
  MAX_QUEUED,
  RATE_LIMIT,
  RATE_LIMIT_GLOBAL,
  queueDepth,
  resetRateLimit,
  tokenMatches,
  withSlot,
  withinRateLimit,
} from "./gate";

beforeEach(() => resetRateLimit());

describe("tokenMatches", () => {
  it("accepts the right token and rejects everything else", () => {
    expect(tokenMatches("Bearer secret", "secret")).toBe(true);
    expect(tokenMatches("Bearer wrong!", "secret")).toBe(false);
    expect(tokenMatches("Bearer secre", "secret")).toBe(false);
    expect(tokenMatches("Bearer secrets", "secret")).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(tokenMatches(undefined, "secret")).toBe(false);
    expect(tokenMatches("secret", "secret")).toBe(false);
    expect(tokenMatches("Basic secret", "secret")).toBe(false);
  });

  it("refuses everything when no token is configured", () => {
    // An unconfigured runner must be closed, not open. This is the difference
    // between "no auth yet" and "no auth required".
    expect(tokenMatches("Bearer ", "")).toBe(false);
    expect(tokenMatches("Bearer anything", "")).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    // timingSafeEqual throws when the buffers differ in length, and an
    // exception here would 500 instead of 401.
    expect(() => tokenMatches("Bearer " + "x".repeat(500), "secret")).not.toThrow();
  });
});

describe("withinRateLimit", () => {
  it("allows up to the limit, then refuses", () => {
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect(withinRateLimit("k")).toBe(true);
    }
    expect(withinRateLimit("k")).toBe(false);
  });

  it("counts each key separately", () => {
    for (let i = 0; i < RATE_LIMIT; i++) withinRateLimit("a");
    expect(withinRateLimit("a")).toBe(false);
    expect(withinRateLimit("b")).toBe(true);
  });

  it("forgets entries older than the window", async () => {
    for (let i = 0; i < RATE_LIMIT; i++) withinRateLimit("k", RATE_LIMIT, 20);
    expect(withinRateLimit("k", RATE_LIMIT, 20)).toBe(false);
    // Wait the window out. Without this the whole loop lands inside a single
    // millisecond and nothing has aged, which tests only that the clock is slow.
    await new Promise((r) => setTimeout(r, 40));
    expect(withinRateLimit("k", RATE_LIMIT, 20)).toBe(true);
  });
});

describe("withSlot", () => {
  it("runs one job at a time", async () => {
    let running = 0;
    let peak = 0;
    const job = () =>
      withSlot(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 60));
        running--;
        return "done";
      });

    const results = await Promise.all([job(), job(), job()]);
    expect(results).toEqual(["done", "done", "done"]);
    // The whole point: three callers, never two at once. A gigabyte each
    // against three free on this host.
    expect(peak).toBe(1);
  });

  it("turns callers away once the queue is full rather than holding them", async () => {
    const slow = () =>
      withSlot(async () => {
        await new Promise((r) => setTimeout(r, 300));
        return "ok";
      });
    // One runs, MAX_QUEUED wait, the next is refused.
    const inFlight = [slow()];
    for (let i = 0; i < MAX_QUEUED; i++) inFlight.push(slow());
    await new Promise((r) => setTimeout(r, 30));
    const refused = await withSlot(async () => "should not run");
    expect(refused).toBeNull();
    await Promise.all(inFlight);
  });

  it("frees its slot when the job throws", async () => {
    await expect(
      withSlot(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(queueDepth().active).toBe(0);
  });
});

describe("per-caller limits", () => {
  it("does not let one caller exhaust everyone else's budget", () => {
    // The original bug: every build was keyed under the literal string
    // "token", so all of DevStation shared one 30/hour bucket and a single
    // busy client starved the rest.
    for (let i = 0; i < RATE_LIMIT; i++) {
      expect(withinRateLimit("caller:1.2.3.4")).toBe(true);
    }
    expect(withinRateLimit("caller:1.2.3.4")).toBe(false);
    expect(withinRateLimit("caller:5.6.7.8")).toBe(true);
  });

  it("keeps a global ceiling above the per-caller one", () => {
    // Many distinct callers must still not swamp a host running one job at a
    // time, so the backstop has to be higher than an individual's limit.
    expect(RATE_LIMIT_GLOBAL).toBeGreaterThan(RATE_LIMIT);
    for (let i = 0; i < RATE_LIMIT_GLOBAL; i++) {
      expect(withinRateLimit("all", RATE_LIMIT_GLOBAL)).toBe(true);
    }
    expect(withinRateLimit("all", RATE_LIMIT_GLOBAL)).toBe(false);
  });
});
