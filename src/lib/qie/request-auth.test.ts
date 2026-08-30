import { describe, expect, it } from "bun:test";
import {
  AUTH_PROBLEM_MESSAGE,
  QIE_SIG_TTL_MS,
  identifierAllowed,
  issuedAtProblem,
  verifyRequestMessage,
} from "./request-auth";

describe("verifyRequestMessage", () => {
  it("is stable and states plainly what signing does", () => {
    const m = verifyRequestMessage({
      address: "0xAbC",
      identifier: "0xAbC",
      issuedAt: 1_700_000_000_000,
    });
    expect(m).toContain("DevStation identity verification request");
    expect(m).toContain("authorises no transfer");
    // Lowercased so the two sides cannot disagree on checksum casing.
    expect(m).toContain("address: 0xabc");
  });

  it("changes when any field changes, so a signature cannot be replayed elsewhere", () => {
    const base = { address: "0xa", identifier: "0xa", issuedAt: 1 };
    expect(verifyRequestMessage(base)).not.toBe(verifyRequestMessage({ ...base, issuedAt: 2 }));
    expect(verifyRequestMessage(base)).not.toBe(
      verifyRequestMessage({ ...base, address: "0xb", identifier: "0xb" }),
    );
  });
});

describe("issuedAtProblem", () => {
  const now = 1_700_000_000_000;

  it("accepts a fresh timestamp", () => {
    expect(issuedAtProblem(now, now)).toBeNull();
  });

  it("rejects one that has aged out", () => {
    expect(issuedAtProblem(now - QIE_SIG_TTL_MS - 1000, now)).toBe("expired");
  });

  it("rejects one from the future beyond clock skew", () => {
    expect(issuedAtProblem(now + 10 * 60_000, now)).toBe("future");
  });

  it("tolerates small clock skew rather than failing honest requests", () => {
    expect(issuedAtProblem(now + 30_000, now)).toBeNull();
  });

  it("treats nonsense as expired rather than throwing", () => {
    expect(issuedAtProblem(NaN, now)).toBe("expired");
  });
});

describe("identifierAllowed", () => {
  it("permits a wallet to verify only itself", () => {
    // The whole point: otherwise anyone could aim consent prompts at anyone.
    expect(identifierAllowed("0xAbC", "0xabc")).toBe(true);
    expect(identifierAllowed("0xAbC", "0xdef")).toBe(false);
  });

  it("refuses a name or handle, which DevStation cannot prove control of", () => {
    expect(identifierAllowed("0xAbC", "someone.qie")).toBe(false);
    expect(identifierAllowed("0xAbC", "@someone")).toBe(false);
  });
});

describe("AUTH_PROBLEM_MESSAGE", () => {
  it("tells the user what to do without narrating the check that failed", () => {
    for (const m of Object.values(AUTH_PROBLEM_MESSAGE)) {
      expect(m.length).toBeGreaterThan(10);
      expect(m.toLowerCase()).not.toContain("hmac");
    }
  });
});
