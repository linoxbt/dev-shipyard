import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

// A shared link to the figures, against a stand-in database: only a live link
// opens anything, and what it opens never names an account.

const TOKEN = "a".repeat(43);
const hash = createHash("sha256").update(TOKEN).digest("hex");
let db: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  db = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.endsWith("/stats_shares")) {
        if (req.method === "PATCH") return Response.json([]);
        const live = url.search.includes(`token_hash=eq.${hash}`);
        return Response.json(
          live ? [{ id: "s1", label: "Investors", views: 2, revoked_at: null }] : [],
        );
      }
      if (url.pathname.endsWith("/rpc/devstation_dashboard")) {
        return Response.json({
          kpis: { accounts: 3 },
          top_accounts: [{ account: "ada@example.com", owner: "0xabc", turns: 4 }],
          recent_accounts: [{ account: "kim@example.com", owner: "0xdef", turns: 1 }],
        });
      }
      return Response.json([]);
    },
  });
  for (const k of ["SESSION_SECRET", "VITE_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])
    saved[k] = process.env[k];
  process.env.SESSION_SECRET = "test-secret-for-shared-stats";
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

async function get(query: string) {
  const { Route } = await import("@/routes/api.stats.shared");
  const handler = (
    Route.options as unknown as {
      server: { handlers: { GET: (c: { request: Request }) => Promise<Response> } };
    }
  ).server.handlers.GET;
  return handler({ request: new Request(`https://site.test/api/stats/shared?${query}`) });
}

describe("/api/stats/shared", () => {
  it("opens nothing for an unknown, revoked or malformed link", async () => {
    expect((await get(`token=${"b".repeat(43)}`)).status).toBe(404);
    expect((await get("token=short")).status).toBe(404);
    expect((await get("")).status).toBe(404);
  });

  it("shows the figures for a live link, with every account a pseudonym", async () => {
    const res = await get(`token=${TOKEN}&days=7`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("@example.com");
    expect(text).not.toContain("0xabc");
    const body = JSON.parse(text) as {
      label: string;
      dashboard: { top_accounts: { account: string }[] };
    };
    expect(body.label).toBe("Investors");
    expect(body.dashboard.top_accounts[0].account).toMatch(/^acct_[0-9a-f]{12}$/);
  });

  it("offers only the three downloads", async () => {
    expect((await get(`token=${TOKEN}&download=../../etc`)).status).toBe(400);
  });
});
