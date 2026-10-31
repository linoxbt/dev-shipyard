import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readGrant, sealToken } from "./connectors.server";
import { expiresSoon, oauthConfigured, readState, safeBack, startUrl } from "./oauth.server";

const KEYS = [
  "SESSION_SECRET",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "VERCEL_OAUTH_CLIENT_ID",
  "VERCEL_OAUTH_CLIENT_SECRET",
  "VERCEL_INTEGRATION_SLUG",
  "RAILWAY_OAUTH_CLIENT_ID",
  "RAILWAY_OAUTH_CLIENT_SECRET",
];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.SESSION_SECRET = "test-secret-for-oauth";
  process.env.GITHUB_OAUTH_CLIENT_ID = "gh-id";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "gh-secret";
  process.env.RAILWAY_OAUTH_CLIENT_ID = "rw-id";
  process.env.RAILWAY_OAUTH_CLIENT_SECRET = "rw-secret";
  delete process.env.VERCEL_OAUTH_CLIENT_ID;
  delete process.env.VERCEL_OAUTH_CLIENT_SECRET;
  delete process.env.VERCEL_INTEGRATION_SLUG;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = new Request("https://devstation.example/api/oauth/github?back=/");

describe("connecting an account over OAuth", () => {
  it("only offers providers whose app is set up", () => {
    const on = oauthConfigured();
    expect(on.github).toBe(true);
    expect(on.railway).toBe(true);
    expect(on.vercel).toBe(false);
    expect(on.netlify).toBe(false);
    expect(startUrl(req, "vercel", "owner-1", "/")).toBeNull();
  });

  it("sends the person to the provider with a sealed state and PKCE", () => {
    const url = new URL(startUrl(req, "github", "owner-1", "/?p=abc")!);
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("gh-id");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://devstation.example/api/oauth/github/callback",
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const state = readState(url.searchParams.get("state"), "github", "owner-1");
    expect(state?.back).toBe("/?p=abc");
    expect(state?.v.length).toBeGreaterThan(20);
  });

  it("asks Railway for a refresh token", () => {
    const url = new URL(startUrl(req, "railway", "owner-1", "/")!);
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("refuses a state for another account, another provider, or past its time", () => {
    const url = new URL(startUrl(req, "github", "owner-1", "/")!);
    const state = url.searchParams.get("state");
    expect(readState(state, "github", "owner-2")).toBeNull();
    expect(readState(state, "railway", "owner-1")).toBeNull();
    expect(readState(state, "github", null)).toBeNull();
    expect(readState(state, "github", "owner-1", Date.now() + 60 * 60_000)).toBeNull();
    expect(readState("forged", "github", "owner-1")).toBeNull();
  });

  it("only returns to paths on this site", () => {
    expect(safeBack("/?p=1")).toBe("/?p=1");
    expect(safeBack("//evil.example")).toBe("/");
    expect(safeBack("https://evil.example")).toBe("/");
    expect(safeBack(null)).toBe("/");
  });

  it("reads grants, and tokens kept before OAuth", () => {
    expect(readGrant(sealToken("plain-token"))).toEqual({ a: "plain-token" });
    expect(readGrant(sealToken(JSON.stringify({ a: "x", r: "y", e: 5 })))).toEqual({
      a: "x",
      r: "y",
      e: 5,
    });
    expect(readGrant("garbage")).toBeNull();
  });

  it("refreshes a grant only when it is about to expire", () => {
    const now = Date.now();
    expect(expiresSoon({ a: "x" }, now)).toBe(false);
    expect(expiresSoon({ a: "x", e: now + 60 * 60_000 }, now)).toBe(false);
    expect(expiresSoon({ a: "x", e: now + 60_000 }, now)).toBe(true);
  });
});
