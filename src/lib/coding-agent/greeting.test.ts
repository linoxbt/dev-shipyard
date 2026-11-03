import { describe, expect, it } from "bun:test";
import { greeting } from "./greeting";

const at = (day: number, hour: number) => new Date(2026, 10, 1 + day, hour, 15); // Nov 1 2026 is a Sunday

describe("the greeting", () => {
  it("follows the time of day", () => {
    expect(greeting("Maya", at(1, 9), { roll: 0 }).hello).toBe("Good morning, Maya");
    expect(greeting("Maya", at(2, 14), { roll: 0 }).hello).toBe("Good afternoon, Maya");
    expect(greeting("Maya", at(2, 19), { roll: 0 }).hello).toBe("Good evening, Maya");
    const late = greeting("Maya", at(2, 1), { roll: 0 });
    expect(late.hello).toBe("Burning the midnight oil, Maya");
    expect(late.mark).toBe("?");
  });

  it("knows the day of the week and a return visit", () => {
    const all = (d: Date, returning = false) =>
      Array.from({ length: 40 }, (_, i) => greeting("Maya", d, { roll: i / 40, returning }).hello);
    expect(all(at(5, 15))).toContain("Happy Friday, Maya");
    expect(all(at(6, 11))).toContain("Happy Saturday, Maya");
    expect(all(at(1, 8))).toContain("Happy Monday, Maya");
    expect(all(at(3, 10), true)).toContain("Welcome back, Maya");
    expect(all(at(3, 10), false)).not.toContain("Welcome back, Maya");
  });

  it("reads differently from visit to visit, and asks about tonight at night", () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => greeting("Maya", at(3, 20), { roll: i / 20 }).hello),
    );
    expect(seen.size).toBeGreaterThan(2);
    const asks = new Set(
      Array.from({ length: 20 }, (_, i) => greeting(null, at(3, 23), { roll: i / 20 }).ask),
    );
    expect([...asks].every((a) => a.endsWith("?"))).toBe(true);
    expect(asks.has("What will you build tonight?")).toBe(true);
  });

  it("works without a name", () => {
    const g = greeting(null, at(2, 9), { roll: 0 });
    expect(g.hello).toBe("Good morning");
    expect(g.hello).not.toContain("null");
  });
});

describe("long names", () => {
  it("keep the late-night greeting short enough for a phone", () => {
    const all = Array.from(
      { length: 30 },
      (_, i) => greeting("MirrorLabs", new Date(2026, 10, 3, 1, 0), { roll: i / 30 }).hello,
    );
    expect(all.some((h) => h.startsWith("Burning"))).toBe(false);
    expect(all).toContain("Up late, MirrorLabs");
  });
});
