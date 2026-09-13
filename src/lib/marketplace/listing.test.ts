import { describe, expect, it } from "bun:test";
import { bundleHash, bundleProblem, canonicalBundle } from "./bundle";
import {
  formatPrice,
  kindCode,
  kindFromCode,
  listingId,
  parseListingId,
  parseMetadata,
  parsePrice,
  serializeMetadata,
  splitSale,
} from "./listing";

describe("prices", () => {
  it("parses whole units into the contract's integer, per currency", () => {
    expect(parsePrice("1", "QIE")).toBe(10n ** 18n);
    expect(parsePrice("2.5", "QUSDC")).toBe(2_500_000n);
    expect(parsePrice("0", "QIE")).toBe(0n);
  });

  it("refuses what is not a price", () => {
    expect(parsePrice("", "QIE")).toBeNull();
    expect(parsePrice("-1", "QIE")).toBeNull();
    expect(parsePrice("1e3", "QIE")).toBeNull();
    // QUSDC has 6 decimals: a seventh cannot be paid.
    expect(parsePrice("0.0000001", "QUSDC")).toBeNull();
    expect(parsePrice("100000000000000000000", "QIE")).toBeNull(); // over uint96
  });

  it("formats without trailing zeros, and says Free for nothing", () => {
    expect(formatPrice(0n, "QIE")).toBe("Free");
    expect(formatPrice(2_500_000n, "QUSDC")).toBe("2.5 QUSDC");
    expect(formatPrice(10n ** 18n * 1500n, "QIE")).toBe("1,500 QIE");
  });

  it("splits a sale 95/5 the way the contract does", () => {
    expect(splitSale(1_000_000n)).toEqual({ fee: 50_000n, creator: 950_000n });
    // The fee rounds down, never the creator's share.
    expect(splitSale(19n)).toEqual({ fee: 0n, creator: 19n });
  });
});

describe("ids", () => {
  it("round-trips each source", () => {
    expect(parseListingId(listingId("builtin", "simple-erc20"))).toEqual({
      source: "builtin",
      key: "simple-erc20",
    });
    expect(parseListingId(listingId("legacy", 3))).toEqual({ source: "legacy", key: 3 });
    expect(parseListingId(listingId("market", 12))).toEqual({ source: "market", key: 12 });
  });

  it("rejects anything else", () => {
    expect(parseListingId("x-1")).toBeNull();
    expect(parseListingId("m-abc")).toBeNull();
    expect(parseListingId("b-../../etc")).toBeNull();
  });

  it("maps kinds to the contract's codes", () => {
    expect(kindCode("app")).toBe(1);
    expect(kindFromCode(3)).toBe("ui-kit");
  });
});

describe("metadata", () => {
  it("reads what parses and ignores what does not", () => {
    expect(parseMetadata('{"category":"DeFi","tags":["vault"]}')).toEqual({
      category: "DeFi",
      tags: ["vault"],
    });
    expect(parseMetadata("not json")).toEqual({});
    expect(parseMetadata('{"demoUrl":"javascript:alert(1)"}')).toEqual({});
  });

  it("fits the contract's size limit", () => {
    const long = serializeMetadata({
      readme: "x".repeat(2500),
      files: Array(60).fill("a".repeat(150)),
    });
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(4000);
  });
});

describe("bundles", () => {
  it("hashes the same files the same way whatever order they were added in", async () => {
    const a = await bundleHash({ "b.ts": "2", "a.ts": "1" });
    const b = await bundleHash({ "a.ts": "1", "b.ts": "2" });
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await bundleHash({ "a.ts": "1", "b.ts": "3" })).not.toBe(a);
  });

  it("pins the canonical form, so the server and the browser cannot drift", async () => {
    expect(canonicalBundle({ "b.ts": "2", "a.ts": "1" })).toBe('[["a.ts","1"],["b.ts","2"]]');
    expect(await bundleHash({ "SKILL.md": "# Review" })).toBe(
      ("0x" +
        Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode('[["SKILL.md","# Review"]]'),
            ),
          ),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("")) as `0x${string}`,
    );
  });

  it("refuses unsafe paths and empty or oversized bundles", () => {
    expect(bundleProblem({ "src/App.tsx": "x" })).toBeNull();
    expect(bundleProblem({})).toContain("at least one");
    expect(bundleProblem({ "../evil.ts": "x" })).toContain("safe");
    expect(bundleProblem({ "/etc/passwd": "x" })).toContain("safe");
    expect(bundleProblem({ "a//b.ts": "x" })).toContain("safe");
    expect(bundleProblem({ "a.ts": 5 })).toContain("not text");
    expect(bundleProblem({ "big.txt": "x".repeat(10 * 1024 * 1024 + 1) })).toContain("10 MB");
  });
});
