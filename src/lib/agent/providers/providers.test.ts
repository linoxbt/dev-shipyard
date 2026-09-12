import { describe, expect, it } from "bun:test";
import { toAnthropicMessages } from "./anthropic";
import { MockProvider } from "./mock";
import {
  configuredProviderName,
  providerFromEnv,
  addUsage,
  EMPTY_USAGE,
  OpenRouterProvider,
} from "./index";
import type { ProviderMessage } from "./types";

// The mapping from our message list to Anthropic's is where ports of this
// normally break, so it is tested directly rather than only through a live
// call that would need a key and a network.

describe("mapping messages to Anthropic", () => {
  it("turns a tool result into a user message, because there is no tool role", () => {
    const out = toAnthropicMessages([
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "read_file", input: {} }] },
      { role: "tool", toolCallId: "t1", content: "contents" },
    ]);
    expect(out.at(-1)!.role).toBe("user");
    const blocks = out.at(-1)!.content as Array<{ type: string; tool_use_id?: string }>;
    expect(blocks[0].type).toBe("tool_result");
    expect(blocks[0].tool_use_id).toBe("t1");
  });

  it("puts every result of one turn in a SINGLE user message, in order", () => {
    // Splitting these across separate messages is the thing that quietly
    // teaches the model to stop making parallel calls at all.
    const out = toAnthropicMessages([
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          { id: "a", name: "read_file", input: {} },
          { id: "b", name: "list_files", input: {} },
        ],
      },
      { role: "tool", toolCallId: "a", content: "A" },
      { role: "tool", toolCallId: "b", content: "B" },
    ]);
    const userMessages = out.filter((m) => m.role === "user");
    expect(userMessages).toHaveLength(2); // the goal, then one results message
    const blocks = userMessages.at(-1)!.content as Array<{ tool_use_id: string }>;
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.tool_use_id)).toEqual(["a", "b"]);
  });

  it("marks a failed tool result rather than dropping it", () => {
    // A dropped result leaves the model waiting for an answer forever.
    const out = toAnthropicMessages([
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "run_build", input: {} }] },
      { role: "tool", toolCallId: "t1", content: "boom", isError: true },
    ]);
    const blocks = out.at(-1)!.content as Array<{ is_error?: boolean }>;
    expect(blocks[0].is_error).toBe(true);
  });

  it("keeps an assistant turn's prose and its calls together", () => {
    const out = toAnthropicMessages([
      { role: "user", content: "go" },
      { role: "assistant", content: "Looking.", toolCalls: [{ id: "t1", name: "x", input: {} }] },
    ]);
    const blocks = out.at(-1)!.content as Array<{ type: string }>;
    expect(blocks.map((b) => b.type)).toEqual(["text", "tool_use"]);
  });

  it("drops an assistant turn with neither prose nor calls", () => {
    // Empty content is rejected by the API, so it must not be sent at all.
    const out = toAnthropicMessages([
      { role: "user", content: "go" },
      { role: "assistant", content: "" },
    ]);
    expect(out).toHaveLength(1);
  });

  it("does not merge tool results that belong to different turns", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "go" },
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: "x", input: {} }] },
      { role: "tool", toolCallId: "a", content: "A" },
      { role: "assistant", content: "", toolCalls: [{ id: "b", name: "y", input: {} }] },
      { role: "tool", toolCallId: "b", content: "B" },
    ];
    const out = toAnthropicMessages(messages);
    const results = out.filter(
      (m) =>
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>)[0]?.type === "tool_result",
    );
    expect(results).toHaveLength(2);
  });
});

describe("the mock provider", () => {
  it("follows its script and records what it was asked", async () => {
    const mock = new MockProvider([
      { text: "thinking", toolCalls: [{ id: "t1", name: "read_file", input: { path: "a.js" } }] },
      { text: "done" },
    ]);
    const first = await mock.generate({
      system: "SYS",
      messages: [{ role: "user", content: "go" }],
    });
    expect(first.toolCalls[0].name).toBe("read_file");
    expect(first.stopReason).toBe("tool_use");

    const second = await mock.generate({ system: "SYS", messages: [] });
    expect(second.text).toBe("done");
    expect(second.stopReason).toBe("end_turn");

    expect(mock.turnsUsed).toBe(2);
    expect(mock.calls[0].system).toBe("SYS");
  });

  it("streams prose in more than one piece", async () => {
    // Code that only ever sees a single delta tends to mishandle the real thing.
    const chunks: string[] = [];
    const mock = new MockProvider([{ text: "x".repeat(100) }]);
    await mock.generate({ system: "", messages: [], onDelta: (c) => chunks.push(c) });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toHaveLength(100);
  });

  it("keeps answering past the end of the script", async () => {
    // So a loop bug reads as "too many turns", not as an exception.
    const mock = new MockProvider([{ text: "only" }]);
    await mock.generate({ system: "", messages: [] });
    const extra = await mock.generate({ system: "", messages: [] });
    expect(extra.text).toBe("only");
  });
});

describe("choosing a provider", () => {
  it("prefers Anthropic when a key for it exists", () => {
    expect(configuredProviderName({ ANTHROPIC_API_KEY: "k", OPENROUTER_API_KEY: "o" })).toBe(
      "anthropic",
    );
  });

  it("falls back to OpenRouter", () => {
    expect(configuredProviderName({ OPENROUTER_API_KEY: "o" })).toBe("openrouter");
    expect(configuredProviderName({ AI_API_KEY: "o" })).toBe("openrouter");
  });

  it("reports nothing configured instead of throwing", () => {
    expect(configuredProviderName({})).toBeNull();
    expect(providerFromEnv({})).toBeNull();
  });
});

describe("usage accounting", () => {
  it("sums a turn into a running total", () => {
    const total = addUsage(
      { ...EMPTY_USAGE, inputTokens: 10, outputTokens: 5 },
      { ...EMPTY_USAGE, inputTokens: 3, cacheReadTokens: 7 },
    );
    expect(total).toEqual({
      inputTokens: 13,
      outputTokens: 5,
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
    });
  });
});

describe("an OpenAI-compatible endpoint", () => {
  const realFetch = globalThis.fetch;

  function capture() {
    const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
      [];
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: JSON.parse(String(init?.body ?? "{}")),
      });
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"hi"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
            ),
          );
          c.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    return seen;
  }

  it("posts to the endpoint it was given, with no OpenRouter extras", async () => {
    const seen = capture();
    try {
      const provider = new OpenRouterProvider("", "llama3.3", {
        name: "openai",
        baseUrl: "http://localhost:11434/v1/",
      });
      const result = await provider.generate({
        system: "s",
        messages: [{ role: "user", content: "q" }],
      });
      expect(result.text).toBe("hi");
      expect(seen[0].url).toBe("http://localhost:11434/v1/chat/completions");
      // A local server needs no key, and an empty bearer is rejected by some.
      expect(seen[0].headers.authorization).toBeUndefined();
      expect(seen[0].headers["HTTP-Referer"]).toBeUndefined();
      expect(seen[0].body.reasoning).toBeUndefined();
      expect(provider.name).toBe("openai");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps OpenRouter exactly as it was by default", async () => {
    const seen = capture();
    try {
      const provider = new OpenRouterProvider("sk-or", "a/b");
      await provider.generate({ system: "s", messages: [{ role: "user", content: "q" }] });
      expect(seen[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(seen[0].headers.authorization).toBe("Bearer sk-or");
      expect(seen[0].headers["X-Title"]).toBe("DevStation");
      expect(provider.name).toBe("openrouter");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
