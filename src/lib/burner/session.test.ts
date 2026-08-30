import { describe, expect, it, beforeEach } from "bun:test";
import { DEFAULT_UNLOCK_MS, UNLOCK_OPTIONS, getUnlockMs, setUnlockMs } from "./session";

// A minimal localStorage so the preference logic is testable outside a browser.
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
} as Storage;

describe("unlock window preference", () => {
  beforeEach(() => store.clear());

  it("defaults to the SHORTEST option, not the longest", () => {
    // This is how long an unattended tab stays able to spend, so a long
    // window has to be chosen deliberately rather than inherited.
    expect(getUnlockMs()).toBe(DEFAULT_UNLOCK_MS);
    expect(DEFAULT_UNLOCK_MS).toBe(Math.min(...UNLOCK_OPTIONS.map((o) => o.ms)));
  });

  it("round-trips every offered option", () => {
    for (const o of UNLOCK_OPTIONS) {
      setUnlockMs(o.ms);
      expect(getUnlockMs()).toBe(o.ms);
    }
  });

  it("ignores a value that is not on the menu", () => {
    setUnlockMs(UNLOCK_OPTIONS[2].ms);
    setUnlockMs(999 * 24 * 60 * 60 * 1000); // a year
    expect(getUnlockMs()).toBe(UNLOCK_OPTIONS[2].ms);
  });

  it("falls back to the default when storage holds junk", () => {
    store.set("devstation-burner-unlock-ms", "not-a-number");
    expect(getUnlockMs()).toBe(DEFAULT_UNLOCK_MS);
  });

  it("offers exactly the durations promised, capped at one day", () => {
    expect(UNLOCK_OPTIONS.map((o) => o.label)).toEqual([
      "5 minutes",
      "30 minutes",
      "1 hour",
      "5 hours",
      "1 day",
    ]);
    expect(Math.max(...UNLOCK_OPTIONS.map((o) => o.ms))).toBe(24 * 60 * 60 * 1000);
  });
});
