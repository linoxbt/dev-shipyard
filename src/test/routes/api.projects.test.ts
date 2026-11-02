import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { claimCookieHeader, withOwner } from "@/lib/agent-access/claims.server";

// Projects saved per account, against a stand-in database: only the signed-in
// account's rows are read or written, a too-large project is refused with a
// reason, and the reply says whether this version won.

const OWNER = `0x${"a".repeat(40)}`;
let db: ReturnType<typeof Bun.serve>;
const calls: { path: string; body: unknown }[] = [];
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  db = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.json().catch(() => null);
      calls.push({ path: url.pathname + url.search, body });
      if (url.pathname.endsWith("/rpc/save_project")) {
        const b = body as { p_updated: number };
        return Response.json(b.p_updated === 5 ? 9 : b.p_updated);
      }
      return Response.json([
        { id: "app-1", name: "One", updated_at: "7", deleted: false, size: 10 },
      ]);
    },
  });
  for (const k of ["SESSION_SECRET", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
    saved[k] = process.env[k];
  process.env.SESSION_SECRET = "test-secret-for-projects";
  process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${db.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
});

afterAll(() => {
  db.stop(true);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function handler(method: "GET" | "POST") {
  const { Route } = await import("@/routes/api.projects");
  return (
    Route.options as unknown as {
      server: { handlers: Record<string, (c: { request: Request }) => Promise<Response>> };
    }
  ).server.handlers[method];
}

const cookie = () => claimCookieHeader(withOwner(null, OWNER)).split(";")[0];

describe("/api/projects", () => {
  it("needs a signed-in account", async () => {
    const res = await (
      await handler("GET")
    )({ request: new Request("https://site.test/api/projects") });
    expect(res.status).toBe(401);
  });

  it("lists only the signed-in account's projects", async () => {
    calls.length = 0;
    const res = await (
      await handler("GET")
    )({
      request: new Request("https://site.test/api/projects", { headers: { cookie: cookie() } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { projects: { id: string; updatedAt: number }[] };
    expect(body.projects[0]).toMatchObject({ id: "app-1", updatedAt: 7 });
    expect(calls[0].path).toContain(`owner=eq.${OWNER}`);
  });

  it("saves for the signed-in account, and says when a newer version is stored", async () => {
    const post = await handler("POST");
    const send = (payload: unknown) =>
      post({
        request: new Request("https://site.test/api/projects", {
          method: "POST",
          headers: { cookie: cookie(), "content-type": "application/json" },
          body: JSON.stringify(payload),
        }),
      });
    calls.length = 0;
    const won = await send({ id: "app-1", name: "One", updatedAt: 12, body: "H4sI" });
    expect(await won.json()).toMatchObject({ applied: true, stored: 12 });
    expect((calls[0].body as { p_owner: string }).p_owner).toBe(OWNER);

    const lost = await send({ id: "app-1", name: "One", updatedAt: 5, body: "H4sI" });
    expect(await lost.json()).toMatchObject({ applied: false, stored: 9 });

    const big = await send({ id: "app-1", updatedAt: 13, body: "x".repeat(4_300_000) });
    expect(big.status).toBe(413);

    expect((await send({ id: "../etc", updatedAt: 1, body: "x" })).status).toBe(400);
  });
});
