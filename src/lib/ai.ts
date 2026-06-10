// AI chat client for the Contract Editor assistant + "Code with AI".
//
// Three modes, resolved from ai-settings.ts:
//   • server proxy — POST /api/ai; the key lives server-side (set VITE_AI_PROXY
//     plus a server-only key). Preferred: nothing sensitive reaches the browser.
//   • "anthropic"  — Claude via the native Messages API (api.anthropic.com).
//   • "openai"     — any OpenAI-compatible /chat/completions endpoint.
//
// The two direct modes are bring-your-own-key: the user pastes a key in the UI,
// stored in this browser only. That's fine for a personal dev console, but the
// key is visible to anyone using the build — for a shared deployment, use the
// server proxy instead.

import {
  getAiSettings,
  isAiConfigured,
  activeKey,
  AI_PROVIDERS,
  resolveEndpoint,
} from "@/lib/ai-settings";

export { isAiConfigured };
export type { AiProvider } from "@/lib/ai-settings";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const SOLIDITY_SYSTEM_PROMPT =
  "You are a senior Solidity engineer and smart-contract auditor embedded in " +
  "DevStation, a developer console for the QIE blockchain (an EVM chain). Help " +
  "the user write, audit, debug, explain, and improve smart contracts. Write " +
  "PRODUCTION-GRADE, secure code — never toy snippets. Always include an SPDX " +
  "license and pragma ^0.8.20, and build on audited OpenZeppelin v5 contracts " +
  '(imports from "@openzeppelin/contracts/..." resolve from a CDN) rather than ' +
  "hand-rolling ERC-20/721/1155, access control, or math. Apply security best " +
  "practices: explicit visibility, checks-effects-interactions, ReentrancyGuard " +
  "on external-call/transfer functions, input validation with custom errors, " +
  "access control on privileged functions, events for every state change, and " +
  "no tx.origin auth. Add full NatSpec. For ERC-20 tokens, mint the entire " +
  "initial supply to the deployer (msg.sender) in the constructor, scaled by " +
  "10**decimals(). OZ v5 notes: ERC20's constructor does not mint (mint " +
  "explicitly) and Ownable requires an initial owner: Ownable(initialOwner). " +
  "When the user shares a contract, audit it first: list findings by severity " +
  "(Critical/High/Medium/Low/Gas) with concrete fixes. Always put Solidity in " +
  "```solidity fenced code blocks. Be concise but complete.";

// Cap on the assistant's reply length (a contract + explanation fits well
// within this). Responses stream, so this is a length bound, not a timeout one.
const MAX_TOKENS = 4096;
const ANTHROPIC_VERSION = "2023-06-01";

interface ChatOptions {
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
}

interface StreamOptions extends ChatOptions {
  // Called with each text chunk as it arrives.
  onDelta: (chunk: string) => void;
}

// Streams the active provider's reply, invoking onDelta per chunk and returning
// the full text once the stream ends. Prefer this over chat() for UI surfaces.
export async function chatStream({
  system,
  messages,
  signal,
  onDelta,
}: StreamOptions): Promise<string> {
  const s = getAiSettings();
  if (!isAiConfigured()) {
    throw new Error(
      s.proxy
        ? "AI is not configured on the server."
        : "AI is not configured. Pick a provider and model, paste your API key, and save in the AI settings.",
    );
  }
  if (s.proxy) return streamProxy({ system, messages, signal, onDelta });
  return resolveEndpoint(s).kind === "anthropic"
    ? streamAnthropic({ system, messages, signal, onDelta })
    : streamOpenAI({ system, messages, signal, onDelta });
}

// Non-streaming convenience: accumulate the stream and return the full text.
export async function chat(opts: ChatOptions): Promise<string> {
  let out = "";
  await chatStream({ ...opts, onDelta: (c) => (out += c) });
  return out;
}

// --- Anthropic (native Messages API) ---------------------------------------

async function streamAnthropic({
  system,
  messages,
  signal,
  onDelta,
}: StreamOptions): Promise<string> {
  const s = getAiSettings();
  const { endpoint } = resolveEndpoint(s);
  const resp = await fetch(`${endpoint}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": activeKey(s),
      "anthropic-version": ANTHROPIC_VERSION,
      // Required for calls that originate from a browser.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    // Opus 4.x rejects temperature/top_p/top_k — steer via the prompt instead.
    body: JSON.stringify({
      model: s.model,
      max_tokens: MAX_TOKENS,
      system,
      messages,
      stream: true,
    }),
    signal,
  });

  if (!resp.ok || !resp.body) throw await providerError(resp, "Anthropic");
  return consumeStream(resp.body, "anthropic", onDelta);
}

// --- Server proxy (/api/ai) ------------------------------------------------

async function streamProxy({ system, messages, signal, onDelta }: StreamOptions): Promise<string> {
  const resp = await fetch("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ system, messages }),
    signal,
  });
  if (!resp.ok || !resp.body) throw await providerError(resp, "AI proxy");
  // The proxy tags the stream with the upstream format ("anthropic" | "openai").
  const fmt = resp.headers.get("x-ai-provider") === "anthropic" ? "anthropic" : "openai";
  return consumeStream(resp.body, fmt, onDelta);
}

// --- OpenAI-compatible (/chat/completions) ---------------------------------

async function streamOpenAI({ system, messages, signal, onDelta }: StreamOptions): Promise<string> {
  const s = getAiSettings();
  const { endpoint } = resolveEndpoint(s);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${activeKey(s)}`,
  };
  // OpenRouter recommends these attribution headers (optional, harmless elsewhere).
  if (endpoint.includes("openrouter")) {
    headers["HTTP-Referer"] = "https://devstation.app";
    headers["X-Title"] = "DevStation";
  }
  const resp = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: s.model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.2,
      stream: true,
    }),
    signal,
  });

  if (!resp.ok || !resp.body) throw await providerError(resp, AI_PROVIDERS[s.provider].label);
  return consumeStream(resp.body, "openai", onDelta);
}

// Reads a provider's SSE stream, emitting text deltas. Shared by the direct
// Anthropic/OpenAI paths and the server proxy (which forwards either format).
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  format: "anthropic" | "openai",
  onDelta: (chunk: string) => void,
): Promise<string> {
  let out = "";
  for await (const data of sseData(body)) {
    if (format === "openai") {
      if (data === "[DONE]") break;
      let chunk: { choices?: Array<{ delta?: { content?: string } }> };
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        out += delta;
        onDelta(delta);
      }
    } else {
      let evt: {
        type?: string;
        delta?: { type?: string; text?: string };
        error?: { message?: string };
      };
      try {
        evt = JSON.parse(data);
      } catch {
        continue;
      }
      if (evt.type === "error") throw new Error(evt.error?.message || "Anthropic stream error.");
      if (
        evt.type === "content_block_delta" &&
        evt.delta?.type === "text_delta" &&
        evt.delta.text
      ) {
        out += evt.delta.text;
        onDelta(evt.delta.text);
      }
    }
  }
  if (!out) throw new Error("AI returned an empty response.");
  return out;
}

// Parse a fetch body as Server-Sent Events, yielding the payload after each
// `data:` prefix. Both providers stream newline-delimited `data:` lines.
async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line.startsWith("data:")) yield line.slice(5).trim();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function providerError(resp: Response, label: string): Promise<Error> {
  const text = await resp.text().catch(() => "");
  // Anthropic/OpenAI both nest a human message under error.message.
  let detail = text.slice(0, 240);
  try {
    const j = JSON.parse(text) as { error?: { message?: string } };
    if (j.error?.message) detail = j.error.message;
  } catch {
    /* keep raw text */
  }
  return new Error(`${label} request failed (${resp.status}). ${detail}`);
}
