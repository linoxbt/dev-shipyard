import { describe, expect, it } from "bun:test";
import { fitBody, ProxyProvider } from "./proxy";
import type { ProviderResult } from "./types";

const result: ProviderResult = {
  text: "Hello",
  toolCalls: [],
  stopReason: "end_turn",
  model: "qwen",
  usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
};

function ndjson(lines: unknown[], status = 200): Response {
  return new Response(lines.map((l) => `${JSON.stringify(l)}\n`).join(""), { status });
}

describe("the proxy provider", () => {
  it("sends the turn's pass, streams prose and returns the server's result", async () => {
    const seen: { url: string; auth: string | null; body: string }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        auth: new Headers(init.headers).get("authorization"),
        body: String(init.body),
      });
      return ndjson([{ d: "Hel" }, { k: 1 }, { d: "lo" }, { r: result }]);
    }) as unknown as typeof fetch;
    const provider = new ProxyProvider(
      { url: "https://site/api/model", token: "PASS" },
      "auto",
      fake,
    );
    const chunks: string[] = [];
    const out = await provider.generate({
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      onDelta: (c) => chunks.push(c),
    });
    expect(out.text).toBe("Hello");
    expect(chunks.join("")).toBe("Hello");
    expect(seen[0].auth).toBe("Bearer PASS");
    expect(JSON.parse(seen[0].body).messages[0].content).toBe("hi");
  });

  it("says the server's reason when it refuses, and an error frame fails the call", async () => {
    const refusing = (async () =>
      Response.json(
        { message: "Your launch credit is used up" },
        { status: 402 },
      )) as unknown as typeof fetch;
    await expect(
      new ProxyProvider({ url: "https://s/api/model", token: "t" }, "opus-5.5", refusing).generate({
        system: "",
        messages: [],
      }),
    ).rejects.toThrow("launch credit is used up");
    const failing = (async () =>
      ndjson([{ d: "x" }, { e: "Fortytwo is down" }])) as unknown as typeof fetch;
    await expect(
      new ProxyProvider({ url: "https://s/api/model", token: "t" }, "auto", failing).generate({
        system: "",
        messages: [],
      }),
    ).rejects.toThrow("Fortytwo is down");
  });

  it("retries a server error before any answer", async () => {
    let calls = 0;
    const flaky = (async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 503 }) : ndjson([{ r: result }]);
    }) as unknown as typeof fetch;
    const out = await new ProxyProvider(
      { url: "https://s/api/model", token: "t" },
      "auto",
      flaky,
    ).generate({
      system: "",
      messages: [],
    });
    expect(out.text).toBe("Hello");
    expect(calls).toBe(2);
  });

  it("keeps a long request under the body limit, oldest material first", () => {
    const big = "x".repeat(500_000);
    const messages = [
      { role: "user" as const, content: "start", images: [`data:image/jpeg;base64,${big}`] },
      ...Array.from({ length: 10 }, (_, i) => ({
        role: "tool" as const,
        toolCallId: String(i),
        content: big,
      })),
      { role: "user" as const, content: "latest" },
    ];
    const body = fitBody({ system: "s", messages });
    expect(body.length).toBeLessThanOrEqual(3_800_000);
    const parsed = JSON.parse(body) as { messages: { content: string; images?: string[] }[] };
    expect(parsed.messages[0].images).toBeUndefined();
    expect(parsed.messages.at(-1)?.content).toBe("latest");
  });
});

describe("the heartbeat", () => {
  it("swaps in the renewed pass, and says when the pass can no longer be renewed", async () => {
    const seen: string[] = [];
    const answers = [
      Response.json({ ok: true, token: "pass-2" }),
      Response.json({ ok: false, reason: "too_long" }, { status: 403 }),
    ];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push(`${url} ${(init?.headers as Record<string, string>).authorization}`);
      return answers.shift()!;
    }) as unknown as typeof fetch;
    const provider = new ProxyProvider(
      { url: "https://site.test/api/model", token: "pass-1" },
      "auto",
      fake,
    );
    expect(await provider.heartbeat()).toBe("ok");
    expect(provider.token).toBe("pass-2");
    expect(await provider.heartbeat()).toBe("expired");
    expect(seen).toEqual([
      "https://site.test/api/model/heartbeat Bearer pass-1",
      "https://site.test/api/model/heartbeat Bearer pass-2",
    ]);
  });
});

describe("a stream that goes silent", () => {
  it("gives up instead of leaving the turn running forever", async () => {
    const silent = (async () =>
      new Response(
        new ReadableStream({
          start() {
            /* never sends a frame */
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const provider = new ProxyProvider(
      { url: "https://x/api/model", token: "t" },
      "auto",
      silent,
      50,
    );
    await expect(provider.generate({ system: "", messages: [], maxTokens: 10 })).rejects.toThrow(
      /stopped answering/,
    );
  });
});
