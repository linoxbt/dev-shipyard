import { describe, expect, it, beforeEach } from "bun:test";
import {
  DEFAULT_UNLOCK_MS,
  UNLOCK_NEVER,
  UNLOCK_OPTIONS,
  getUnlockMs,
  hasBurnerSession,
  isBurnerSessionIdle,
  setUnlockMs,
  touchBurnerSession,
} from "./session";

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

  it("stays unlocked until the browser's data is cleared, unless a time is chosen", () => {
    // Asking for the password on every visit looked like being disconnected.
    expect(DEFAULT_UNLOCK_MS).toBe(UNLOCK_NEVER);
    expect(getUnlockMs()).toBe(UNLOCK_NEVER);
    expect(UNLOCK_OPTIONS[0]).toEqual({ label: "Until I clear my browser data", ms: UNLOCK_NEVER });
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

  it("offers exactly the windows promised, the timed ones capped at one day", () => {
    expect(UNLOCK_OPTIONS.map((o) => o.label)).toEqual([
      "Until I clear my browser data",
      "5 minutes",
      "30 minutes",
      "1 hour",
      "5 hours",
      "1 day",
    ]);
    const timed = UNLOCK_OPTIONS.filter((o) => o.ms !== UNLOCK_NEVER).map((o) => o.ms);
    expect(Math.max(...timed)).toBe(24 * 60 * 60 * 1000);
  });
});

describe("an unlocked session", () => {
  const SESSION = "devstation-burner-session-v2";
  const blob = (expiresAt: number) => JSON.stringify({ ct: "c2VjcmV0", iv: "aXY=", expiresAt });
  const expiry = () => (JSON.parse(store.get(SESSION)!) as { expiresAt: number }).expiresAt;

  beforeEach(() => store.clear());

  it("never goes idle under the default, so a refresh or restart finds it still connected", () => {
    store.set(SESSION, blob(Date.now() + 1_000));
    touchBurnerSession();
    expect(expiry()).toBe(Number.MAX_SAFE_INTEGER);
    expect(hasBurnerSession()).toBe(true);
    expect(isBurnerSessionIdle()).toBe(false);
  });

  it("still locks after the chosen time when one is picked", () => {
    setUnlockMs(5 * 60 * 1000);
    store.set(SESSION, blob(Number.MAX_SAFE_INTEGER));
    touchBurnerSession();
    expect(expiry()).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
    expect(expiry()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);

    store.set(SESSION, blob(Date.now() - 1));
    expect(hasBurnerSession()).toBe(false);
    expect(isBurnerSessionIdle()).toBe(true);
  });
});
