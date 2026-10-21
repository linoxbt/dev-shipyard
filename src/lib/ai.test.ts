import { describe, expect, it } from "bun:test";
import { acceptsTemperature, consumeStream, fetchWithRetry } from "./ai";

function sse(events: unknown[]): ReadableStream<Uint8Array> {
  const text = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  return new Response(text).body as ReadableStream<Uint8Array>;
}

describe("consumeStream (Anthropic)", () => {
  const delta = (text: string) => ({
    type: "content_block_delta",
    delta: { type: "text_delta", text },
  });

  it("reports a reply cut off at max_tokens instead of returning half of it", async () => {
    const body = sse([
      delta("contract X {"),
      { type: "message_delta", delta: { stop_reason: "max_tokens" } },
    ]);
    await expect(consumeStream(body, "anthropic", () => {})).rejects.toThrow(/cut off/);
  });

  it("surfaces a refusal as one", async () => {
    const body = sse([delta("I"), { type: "message_delta", delta: { stop_reason: "refusal" } }]);
    await expect(consumeStream(body, "anthropic", () => {})).rejects.toThrow(/declined/);
  });

  it("returns a complete reply", async () => {
    const body = sse([delta("ok"), { type: "message_delta", delta: { stop_reason: "end_turn" } }]);
    expect(await consumeStream(body, "anthropic", () => {})).toBe("ok");
  });
});

describe("acceptsTemperature", () => {
  it("drops temperature for reasoning models only", () => {
    expect(acceptsTemperature("gpt-5.6-sol")).toBe(false);
    expect(acceptsTemperature("openai/gpt-5.5")).toBe(false);
    expect(acceptsTemperature("o4-mini")).toBe(false);
    expect(acceptsTemperature("deepseek/deepseek-v4-pro")).toBe(true);
  });
});

describe("fetchWithRetry", () => {
  it("retries a 429 and returns the success", async () => {
    let n = 0;
    const doFetch = (async () =>
      new Response("", { status: ++n < 3 ? 429 : 200 })) as unknown as typeof fetch;
    const res = await fetchWithRetry("u", {}, doFetch, 1);
    expect(res.status).toBe(200);
    expect(n).toBe(3);
  });

  it("does not retry a 401", async () => {
    let n = 0;
    const doFetch = (async () => {
      n++;
      return new Response("", { status: 401 });
    }) as unknown as typeof fetch;
    expect((await fetchWithRetry("u", {}, doFetch, 1)).status).toBe(401);
    expect(n).toBe(1);
  });
});
