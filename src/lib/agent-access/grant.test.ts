import { afterEach, describe, expect, it } from "bun:test";
import { canRequestGrant, ensureGrant, fetchWithGrant, setGrantSession } from "./grant";

// The browser half of DevStation's session: traded from the email sign-in,
// renewed only when the server says it is missing, never twice at once, and
// never in a loop.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setGrantSession(null);
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    return Promise.resolve(handler(String(input), init));
  }) as typeof fetch;
  return calls;
}

describe("the session", () => {
  it("cannot be had without a sign-in", async () => {
    expect(canRequestGrant()).toBe(false);
    expect(await ensureGrant()).toBe(false);
  });

  it("is traded from the sign-in's access token", async () => {
    setGrantSession(async () => "access-token");
    let sent = "";
    stubFetch((url, init) => {
      if (url === "/api/access/session") sent = String(init?.body);
      return json(200, { ok: true });
    });
    expect(await ensureGrant()).toBe(true);
    expect(JSON.parse(sent)).toEqual({ accessToken: "access-token" });
  });

  it("is renewed once on a missing session, then the request is retried", async () => {
    setGrantSession(async () => "access-token");
    let first = true;
    const calls = stubFetch((url) => {
      if (url === "/api/access/session") return json(200, { ok: true });
      if (first) {
        first = false;
        return json(401, { ok: false, reason: "no_grant" });
      }
      return json(200, { ok: true });
    });
    const res = await fetchWithGrant("/api/plan");
    expect(res.status).toBe(200);
    expect(calls).toEqual(["GET /api/plan", "POST /api/access/session", "GET /api/plan"]);
  });

  it("is not renewed for an unrelated 401, and never loops", async () => {
    setGrantSession(async () => "access-token");
    const calls = stubFetch((url) =>
      url === "/api/access/session"
        ? json(401, { ok: false })
        : json(401, { ok: false, reason: "no_grant" }),
    );
    const res = await fetchWithGrant("/api/plan");
    expect(res.status).toBe(401);
    expect(calls).toEqual(["GET /api/plan", "POST /api/access/session"]);
    const other = stubFetch(() => json(401, { ok: false, reason: "not_signed_in" }));
    await fetchWithGrant("/api/x");
    expect(other).toEqual(["GET /api/x"]);
  });

  it("shares one renewal between concurrent callers", async () => {
    setGrantSession(async () => "access-token");
    const calls = stubFetch(() => json(200, { ok: true }));
    await Promise.all([ensureGrant(), ensureGrant(), ensureGrant()]);
    expect(calls.filter((c) => c === "POST /api/access/session")).toHaveLength(1);
  });
});
