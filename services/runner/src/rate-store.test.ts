import { describe, expect, it } from "bun:test";
import { RateStore, parseHit } from "./rate-store";

describe("RateStore", () => {
  it("allows up to the limit in the window, then refuses, then recovers", () => {
    const s = new RateStore();
    expect(s.hit("k", 2, 1000, 0)).toBe(true);
    expect(s.hit("k", 2, 1000, 10)).toBe(true);
    expect(s.hit("k", 2, 1000, 20)).toBe(false);
    expect(s.hit("k", 2, 1000, 1500)).toBe(true);
  });

  it("keeps keys apart", () => {
    const s = new RateStore();
    expect(s.hit("a", 1, 1000, 0)).toBe(true);
    expect(s.hit("b", 1, 1000, 0)).toBe(true);
    expect(s.hit("a", 1, 1000, 1)).toBe(false);
  });
});

describe("parseHit", () => {
  it("accepts a well-formed hit and rejects the rest", () => {
    expect(parseHit({ key: "ai:ip:1", limit: 20, windowMs: 60_000 })).toEqual({
      key: "ai:ip:1",
      limit: 20,
      windowMs: 60_000,
    });
    expect(parseHit({ key: "", limit: 1, windowMs: 60_000 })).toEqual({ error: "key" });
    expect(parseHit({ key: "k", limit: 0, windowMs: 60_000 })).toEqual({ error: "limit" });
    expect(parseHit({ key: "k", limit: 1, windowMs: 5 })).toEqual({ error: "windowMs" });
  });
});
