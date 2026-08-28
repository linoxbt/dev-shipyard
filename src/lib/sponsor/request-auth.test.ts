import { describe, expect, it } from "bun:test";
import { topupMessage, issuedAtProblem, TOPUP_SIG_TTL_MS } from "./request-auth";

describe("topupMessage", () => {
  it("binds the address and chain so a signature cannot be replayed elsewhere", () => {
    const a = topupMessage({ address: "0xAbC", chainId: 1990, issuedAt: 0 });
    expect(a).toContain("address: 0xabc");
    expect(a).toContain("chainId: 1990");
    // Different chain or address ⇒ different bytes ⇒ different signature.
    expect(a).not.toBe(topupMessage({ address: "0xAbC", chainId: 677, issuedAt: 0 }));
    expect(a).not.toBe(topupMessage({ address: "0xdEf", chainId: 1990, issuedAt: 0 }));
  });

  it("is case-insensitive on the address so checksum casing cannot break it", () => {
    expect(topupMessage({ address: "0xABC", chainId: 1, issuedAt: 0 })).toBe(
      topupMessage({ address: "0xabc", chainId: 1, issuedAt: 0 }),
    );
  });

  it("tells the signer it authorises no transfer", () => {
    expect(topupMessage({ address: "0x1", chainId: 1, issuedAt: 0 })).toContain("no gas");
  });
});

describe("issuedAtProblem", () => {
  const now = 1_000_000_000_000;

  it("accepts a fresh timestamp", () => {
    expect(issuedAtProblem(now, now)).toBeNull();
    expect(issuedAtProblem(now - 1000, now)).toBeNull();
  });

  it("rejects an expired signature", () => {
    expect(issuedAtProblem(now - TOPUP_SIG_TTL_MS - 1, now)).toBe("expired");
  });

  it("accepts the boundary exactly at the TTL", () => {
    expect(issuedAtProblem(now - TOPUP_SIG_TTL_MS, now)).toBeNull();
  });

  it("rejects a far-future timestamp but tolerates small clock skew", () => {
    expect(issuedAtProblem(now + 30_000, now)).toBeNull();
    expect(issuedAtProblem(now + 10 * 60_000, now)).toBe("future");
  });

  it("rejects non-finite input outright", () => {
    // Both are rejected by the finite guard before the window checks; a real
    // client never sends these, so the exact label matters less than the fact
    // that neither is ever treated as valid.
    expect(issuedAtProblem(NaN, now)).toBe("expired");
    expect(issuedAtProblem(Infinity, now)).toBe("expired");
    expect(issuedAtProblem(-Infinity, now)).toBe("expired");
  });
});
