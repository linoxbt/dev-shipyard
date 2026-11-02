import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mintTurnPass } from "@/lib/db/turn-token.server";

// The model proxy, end to end against a stand-in OpenAI-compatible server in
// place of Fortytwo: the pass is checked, premium models are refused without
// an upgrade, and a free call streams back.

let server: ReturnType<typeof Bun.serve>;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        [
          `data: ${JSON.stringify({ choices: [{ delta: { content: "Hi " } }] })}`,
          `data: ${JSON.stringify({ choices: [{ delta: { content: "there" }, finish_reason: "stop" }] })}`,
          `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } })}`,
          "data: [DONE]",
          "",
        ].join("\n\n"),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  for (const k of [
    "SESSION_SECRET",
    "FORTYTWO_API_KEY",
    "FORTYTWO_BASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    saved[k] = process.env[k];
  }
  process.env.SESSION_SECRET = "test-secret-for-the-model-proxy";
  process.env.FORTYTWO_API_KEY = "test-key";
  process.env.FORTYTWO_BASE_URL = `http://127.0.0.1:${server.port}/v1`;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterAll(() => {
  server.stop(true);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function call(
  token: string | null,
  body: unknown = { system: "s", messages: [{ role: "user", content: "hi" }] },
) {
  const { Route } = await import("@/routes/api.model");
  const post = (
    Route.options as unknown as {
      server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
    }
  ).server.handlers.POST;
  return post({
    request: new Request("https://site.test/api/model", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    }),
  });
}

describe("/api/model", () => {
  it("refuses a call without a valid pass", async () => {
    expect((await call(null)).status).toBe(401);
    expect((await call("forged")).status).toBe(401);
  });

  it("refuses a premium model to an account without credit or Pro", async () => {
    const res = await call(mintTurnPass({ owner: "0xabc", workspace: "w", model: "opus-5.5" }));
    expect(res.status).toBe(402);
  });

  it("streams a free model's answer back with its usage", async () => {
    const res = await call(mintTurnPass({ owner: "0xabc", workspace: "w", model: "auto" }));
    expect(res.status).toBe(200);
    const lines = (await res.text())
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(
      lines
        .filter((l) => l.d)
        .map((l) => l.d)
        .join(""),
    ).toBe("Hi there");
    const result = lines.find((l) => l.r)?.r;
    expect(result.text).toBe("Hi there");
    expect(result.usage.inputTokens).toBe(12);
  });

  it("refuses a malformed request", async () => {
    const res = await call(mintTurnPass({ owner: "0xabc", workspace: "w", model: "auto" }), {
      nope: 1,
    });
    expect(res.status).toBe(400);
  });
});

// Premium calls against a stand-in database and a stand-in OpenRouter: each
// call is reserved against the balance before it starts and settled after,
// and a call the caller cuts off midway keeps a charge.
describe("/api/model, premium metering", () => {
  let db: ReturnType<typeof Bun.serve>;
  let model: ReturnType<typeof Bun.serve>;
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let hang = false;
  const keys = [
    "VITE_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "ANTHROPIC_API_KEY",
  ];
  const before: Record<string, string | undefined> = {};

  beforeAll(() => {
    db = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        if (url.pathname.endsWith("/rpc/account_access")) return Response.json({ plan: "pro" });
        if (url.pathname.endsWith("/model_usage")) {
          writes.push({ method: req.method, path: url.pathname + url.search, body });
          return Response.json(req.method === "POST" ? [{ id: 7 }] : [{ id: 7 }]);
        }
        return Response.json({});
      },
    });
    model = Bun.serve({
      port: 0,
      fetch() {
        const first = `data: ${JSON.stringify({ choices: [{ delta: { content: "x".repeat(400) } }] })}\n\n`;
        if (hang) {
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode(first));
                // ...and never finishes: the caller will cut it off.
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
        }
        return new Response(
          [
            first.trim(),
            `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 100 } })}`,
            "data: [DONE]",
            "",
          ].join("\n\n"),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    for (const k of keys) before[k] = process.env[k];
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${db.port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.OPENROUTER_API_KEY = "or-key";
    process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${model.port}/v1`;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterAll(() => {
    db.stop(true);
    model.stop(true);
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("reserves the most a call can cost, then settles to what it cost", async () => {
    writes.length = 0;
    hang = false;
    const res = await call(mintTurnPass({ owner: "0xp1", workspace: "w", model: "opus-5.5" }));
    expect(res.status).toBe(200);
    expect((await res.text()).includes('"r"')).toBe(true);
    const [reserve, settle] = writes;
    expect(reserve.method).toBe("POST");
    expect(reserve.body.premium).toBe(true);
    expect(reserve.body.output_tokens).toBe(32_000);
    expect(settle.method).toBe("PATCH");
    expect(settle.path).toContain("id=eq.7");
    expect(settle.body.output_tokens).toBe(100);
    expect(Number(settle.body.cost_usd)).toBeLessThan(Number(reserve.body.cost_usd));
  });

  it("keeps a charge on a call cut off midway", async () => {
    writes.length = 0;
    hang = true;
    const { Route } = await import("@/routes/api.model");
    const post = (
      Route.options as unknown as {
        server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
      }
    ).server.handlers.POST;
    const cut = new AbortController();
    const res = await post({
      request: new Request("https://site.test/api/model", {
        method: "POST",
        signal: cut.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${mintTurnPass({ owner: "0xp2", workspace: "w", model: "opus-5.5" })}`,
        },
        body: JSON.stringify({ system: "s", messages: [{ role: "user", content: "hi" }] }),
      }),
    });
    const reader = res.body!.getReader();
    await reader.read(); // the first piece of the answer
    cut.abort();
    while (!(await reader.read()).done) {
      /* drain until the proxy closes */
    }
    const settle = writes.find((w) => w.method === "PATCH");
    expect(settle?.body.output_tokens).toBe(100);
    expect(Number(settle?.body.cost_usd)).toBeGreaterThan(0);
  });
});
