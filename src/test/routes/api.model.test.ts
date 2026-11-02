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
