import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Route } from "@/routes/api.access.session";
import { CLAIM_COOKIE, openClaims, sealClaims } from "@/lib/agent-access/claims.server";
import { accountAddress } from "@/lib/auth/account.server";
import { verifySupabaseToken } from "@/lib/auth/supabase.server";
import { resetMemoryLimits } from "@/lib/rateLimit.server";

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const ENV = {
  SUPABASE_URL: "https://proj.supabase.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
};
const TOKEN = "t".repeat(40);
const realFetch = globalThis.fetch;
const saved = Object.fromEntries(Object.keys(ENV).map((k) => [k, process.env[k]]));

/** Supabase's /auth/v1/user, answering for one user. */
function supabaseSays(user: Record<string, unknown> | null) {
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    expect(String(url)).toBe("https://proj.supabase.test/auth/v1/user");
    const h = new Headers(init.headers);
    expect(h.get("apikey")).toBe("sb_publishable_x");
    if (!user || h.get("authorization") !== `Bearer ${TOKEN}`)
      return new Response("{}", { status: 401 });
    return Response.json(user);
  }) as unknown as typeof fetch;
}

const post = (body: unknown, cookie?: string) =>
  handlers.POST({
    request: new Request("https://x.test/api/access/session", {
      method: "POST",
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    }),
  });

beforeEach(() => {
  Object.assign(process.env, ENV);
  resetMemoryLimits();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("verifySupabaseToken", () => {
  it("accepts a confirmed account and reads its name", async () => {
    supabaseSays({
      id: "u1",
      email: "Denis@Example.com",
      email_confirmed_at: "2026-10-30T00:00:00Z",
      user_metadata: { full_name: "Denis Alem" },
    });
    expect(await verifySupabaseToken(TOKEN, ENV)).toEqual({
      id: "u1",
      email: "denis@example.com",
      name: "Denis Alem",
    });
  });

  it("refuses an email nobody has confirmed, and a token Supabase rejects", async () => {
    supabaseSays({ id: "u1", email: "a@b.co", email_confirmed_at: null });
    expect(await verifySupabaseToken(TOKEN, ENV)).toBeNull();
    supabaseSays(null);
    expect(await verifySupabaseToken(TOKEN, ENV)).toBeNull();
  });

  it("is off without a project configured", async () => {
    expect(await verifySupabaseToken(TOKEN, {})).toBeNull();
  });
});

describe("/api/access/session", () => {
  it("turns a confirmed session into the grant cookie, owned by the account", async () => {
    supabaseSays({ id: "u1", email: "denis@example.com", email_confirmed_at: "2026-10-30" });
    const res = await post({ accessToken: TOKEN });
    expect(res.status).toBe(200);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${CLAIM_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    const claims = openClaims(cookie.split(";")[0].split("=").slice(1).join("="));
    expect(claims?.owner).toBe(accountAddress("denis@example.com"));
  });

  it("does not hand one person's workspaces to the next person on the browser", async () => {
    supabaseSays({ id: "u2", email: "second@example.com", email_confirmed_at: "2026-10-30" });
    const theirs = sealClaims({
      ids: ["ws-1"],
      owner: accountAddress("first@example.com"),
      exp: Date.now() + 60_000,
    });
    const res = await post({ accessToken: TOKEN }, `${CLAIM_COOKIE}=${theirs}`);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(openClaims(cookie.split(";")[0].split("=").slice(1).join("="))?.ids).toEqual([]);
  });

  it("refuses a session Supabase cannot confirm", async () => {
    supabaseSays(null);
    const res = await post({ accessToken: TOKEN });
    expect(res.status).toBe(401);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("signs out by clearing the cookie", async () => {
    const res = await handlers.DELETE({
      request: new Request("https://x.test/api/access/session"),
    });
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
