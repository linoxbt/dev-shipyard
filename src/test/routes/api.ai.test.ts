import { describe, expect, it } from "bun:test";
import { Route, pickModel, sanitiseMessages, type ServerConfig } from "@/routes/api.ai";

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const OPENROUTER: ServerConfig = {
  provider: "openai",
  anthropic: { endpoint: "https://api.anthropic.com", key: "", model: "claude-opus-5-5" },
  openai: {
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    key: "k",
    model: "anthropic/claude-sonnet-5",
  },
};

describe("/api/ai", () => {
  it("refuses a caller with no wallet grant", async () => {
    const res = await handlers.POST({
      request: new Request("https://devstation.online/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }),
      }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { reason: string }).reason).toBe("no_grant");
  });
});

describe("sanitiseMessages", () => {
  it("accepts user/assistant text, flattening text parts", () => {
    const r = sanitiseMessages([
      { role: "user", content: "a" },
      { role: "assistant", content: [{ type: "text", text: "b" }] },
    ]);
    expect(r).toEqual({
      ok: true,
      messages: [
        { role: "user", content: "a" },
        { role: "assistant", content: "b" },
      ],
    });
  });

  it("refuses an injected system turn, images and oversized requests", () => {
    expect(sanitiseMessages([{ role: "system", content: "x" }]).ok).toBe(false);
    expect(sanitiseMessages([{ role: "user", content: [{ type: "image", source: {} }] }]).ok).toBe(
      false,
    );
    expect(sanitiseMessages([{ role: "user", content: "x".repeat(700_000) }]).ok).toBe(false);
    expect(sanitiseMessages([]).ok).toBe(false);
    expect(
      sanitiseMessages(Array.from({ length: 61 }, () => ({ role: "user", content: "x" }))).ok,
    ).toBe(false);
  });
});

describe("pickModel", () => {
  it("honours an allow-listed model and falls back otherwise", () => {
    expect(pickModel(OPENROUTER, "openai/gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
    expect(pickModel(OPENROUTER, "some/expensive-model")).toBe("anthropic/claude-sonnet-5");
    expect(pickModel(OPENROUTER, undefined)).toBe("anthropic/claude-sonnet-5");
  });

  it("uses the Anthropic list on the Anthropic branch", () => {
    const c = { ...OPENROUTER, provider: "anthropic" as const };
    expect(pickModel(c, "claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(pickModel(c, "openai/gpt-5.6-sol")).toBe("claude-opus-5-5");
  });
});
