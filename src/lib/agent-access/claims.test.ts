import { beforeEach, describe, expect, it } from "bun:test";
import {
  CLAIM_COOKIE,
  claimCookieHeader,
  holdsClaim,
  openClaims,
  ownerOf,
  readCookie,
  sealClaims,
  withClaim,
  withOwner,
} from "./claims.server";
import { agentStartMessage, issuedAtProblem } from "./request-auth";

// The gate that replaced "knowing an id is the whole authorisation".
//
// Written as forgery attempts rather than as unit tests of the happy path,
// because the happy path failing is a bug a user reports in a minute and the
// forgery succeeding is one nobody reports at all.

const OWNER = "0xabc0000000000000000000000000000000000001";

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-for-claims";
});

describe("sealing a claim", () => {
  it("round-trips the ids it was given", () => {
    const sealed = sealClaims(withClaim(null, "agent-1", OWNER));
    expect(holdsClaim(openClaims(sealed), "agent-1")).toBe(true);
  });

  it("does not hold a claim it never issued", () => {
    const sealed = sealClaims(withClaim(null, "agent-1", OWNER));
    expect(holdsClaim(openClaims(sealed), "agent-2")).toBe(false);
  });

  it("refuses a cookie whose payload was edited", () => {
    // The attack: take your own cookie, add someone else's job id, send it.
    const mine = sealClaims(withClaim(null, "agent-mine", OWNER));
    const [payload, mac] = mine.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      ids: string[];
      owner: string;
      exp: number;
    };
    decoded.ids.push("agent-yours");
    const forged = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${mac}`;

    expect(openClaims(forged)).toBeNull();
  });

  it("refuses a cookie signed with a different key", () => {
    const sealed = sealClaims(withClaim(null, "agent-1", OWNER));
    process.env.SESSION_SECRET = "a-different-secret";
    expect(openClaims(sealed)).toBeNull();
  });

  it("refuses a claim that has expired", () => {
    // Signed correctly with the current key, so the expiry is the only thing
    // that can reject it.
    const sealed = sealClaims({ ids: ["agent-1"], owner: OWNER, exp: Date.now() - 1 });
    expect(openClaims(sealed)).toBeNull();
    // And the same claim with a live expiry does open, which is what makes the
    // assertion above about the expiry rather than about the signature.
    expect(
      openClaims(sealClaims({ ids: ["agent-1"], owner: OWNER, exp: Date.now() + 60_000 })),
    ).not.toBeNull();
  });

  it("survives rubbish without throwing", () => {
    for (const bad of ["", "no-dot", "a.b", "....", "%%%.%%%"]) {
      expect(openClaims(bad)).toBeNull();
    }
    expect(openClaims(undefined)).toBeNull();
  });
});

describe("what the cookie carries", () => {
  it("keeps the owner, so a job's owner is not a field the caller typed", () => {
    expect(ownerOf(openClaims(sealClaims(withOwner(null, OWNER))))).toBe(OWNER);
    expect(ownerOf(null)).toBeNull();
  });

  it("keeps ids across a re-signature, so a live run is not orphaned", () => {
    const first = withClaim(null, "agent-running", OWNER);
    const renewed = withOwner(first, OWNER);
    expect(holdsClaim(renewed, "agent-running")).toBe(true);
  });

  it("bounds the list, because a cookie that grows stops being sent", () => {
    let claim = withClaim(null, "agent-0", OWNER);
    for (let i = 1; i < 60; i++) claim = withClaim(claim, `agent-${i}`, OWNER);
    expect(claim.ids.length).toBeLessThanOrEqual(30);
    // The newest survive; the oldest are the ones to lose.
    expect(holdsClaim(claim, "agent-59")).toBe(true);
    expect(holdsClaim(claim, "agent-0")).toBe(false);
  });

  it("does not repeat an id it already holds", () => {
    const claim = withClaim(withClaim(null, "agent-1", OWNER), "agent-1", OWNER);
    expect(claim.ids).toEqual(["agent-1"]);
  });

  it("is httpOnly, same-site and path-wide", () => {
    const header = claimCookieHeader(withClaim(null, "agent-1", OWNER));
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header.startsWith(`${CLAIM_COOKIE}=`)).toBe(true);
  });

  it("reads one cookie out of a header with several", () => {
    expect(readCookie("a=1; devstation_jobs=xyz; b=2", CLAIM_COOKIE)).toBe("xyz");
    expect(readCookie("a=1", CLAIM_COOKIE)).toBeUndefined();
    expect(readCookie(null, CLAIM_COOKIE)).toBeUndefined();
  });
});

describe("the message a wallet signs", () => {
  it("names the wallet and says it authorises no transfer", () => {
    const message = agentStartMessage({ address: OWNER, issuedAt: 1_700_000_000_000 });
    expect(message).toContain(OWNER.toLowerCase());
    expect(message).toContain("costs no gas and authorises no transfer");
  });

  it("expires, and rejects a clock from the future", () => {
    const now = 1_700_000_000_000;
    expect(issuedAtProblem(now, now)).toBeNull();
    expect(issuedAtProblem(now - 6 * 60 * 1000, now)).toBe("expired");
    expect(issuedAtProblem(now + 5 * 60 * 1000, now)).toBe("future");
    expect(issuedAtProblem(Number.NaN, now)).toBe("expired");
  });
});
