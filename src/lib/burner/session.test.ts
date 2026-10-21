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

// Minimal Web Storage so the preference and session logic is testable outside
// a browser. Two of them: the session lives in localStorage, and sessionStorage
// is kept to prove nothing from the previous per-tab release lingers there.
function fakeStorage(map: Map<string, string>): Storage {
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}
const local = new Map<string, string>();
const session = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = fakeStorage(local);
(globalThis as unknown as { sessionStorage: Storage }).sessionStorage = fakeStorage(session);

const clearAll = () => {
  local.clear();
  session.clear();
};

describe("unlock window preference", () => {
  beforeEach(clearAll);

  it("defaults to a short idle window, not 'stay unlocked'", () => {
    expect(DEFAULT_UNLOCK_MS).toBe(30 * 60 * 1000);
    expect(getUnlockMs()).toBe(DEFAULT_UNLOCK_MS);
    expect(UNLOCK_NEVER).toBe(0);
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
    local.set("devstation-burner-unlock-ms", "not-a-number");
    expect(getUnlockMs()).toBe(DEFAULT_UNLOCK_MS);
  });

  it("offers timed windows capped at one day, and 'never' last with its cost spelled out", () => {
    const timed = UNLOCK_OPTIONS.filter((o) => o.ms !== UNLOCK_NEVER).map((o) => o.ms);
    expect(Math.max(...timed)).toBe(24 * 60 * 60 * 1000);
    const last = UNLOCK_OPTIONS[UNLOCK_OPTIONS.length - 1];
    expect(last.ms).toBe(UNLOCK_NEVER);
    expect(last.label).toMatch(/less safe/);
  });
});

describe("an unlocked session", () => {
  const SESSION = "devstation-burner-session-v2";
  const blob = (expiresAt: number) => JSON.stringify({ ct: "c2VjcmV0", iv: "aXY=", expiresAt });
  const expiryIn = (m: Map<string, string>) =>
    (JSON.parse(m.get(SESSION)!) as { expiresAt: number }).expiresAt;

  beforeEach(clearAll);

  it("lives in localStorage so every tab shares it, and its window slides on activity", () => {
    local.set(SESSION, blob(Date.now() + 1_000));
    touchBurnerSession();
    expect(expiryIn(local)).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
    expect(session.has(SESSION)).toBe(false);
    expect(hasBurnerSession()).toBe(true);
  });

  it("locks once the window has passed, and the lapsed session is deleted", () => {
    local.set(SESSION, blob(Date.now() - 1));
    expect(isBurnerSessionIdle()).toBe(true);
    expect(local.has(SESSION)).toBe(false);
    expect(hasBurnerSession()).toBe(false);
  });

  it("the explicit opt-in never expires, and opting out puts an end on a live session", () => {
    local.set(SESSION, blob(Date.now() + 60_000));
    setUnlockMs(UNLOCK_NEVER);
    touchBurnerSession();
    expect(expiryIn(local)).toBe(Number.MAX_SAFE_INTEGER);

    setUnlockMs(5 * 60 * 1000);
    expect(expiryIn(local)).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    expect(hasBurnerSession()).toBe(true);
  });
});
