import {
  EMPTY_USAGE,
  type GenerateInput,
  type ModelProvider,
  type ProviderMessage,
  type ProviderResult,
  type ProviderToolCall,
  type StopReason,
} from "./types";

// OpenRouter, kept because it is what the runner already has a working key for.
//
// It speaks the OpenAI-compatible shape, which differs from Anthropic's in the
// two places that matter here: a tool result IS its own `tool` role (so no
// folding is needed), and tool arguments arrive as a JSON *string* that has to
// be parsed rather than as an object.
//
// Streaming is hand-parsed because there is no vendor SDK to lean on. That is
// precisely the work the Anthropic implementation avoids by using one.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * The reply ceiling per request.
 *
 * It was 64,000, which is several times what an agent turn writes, and on
 * OpenRouter it is not free: the whole ceiling is held against the balance
 * before the request runs. At Opus 5's $25 per million output tokens that is
 * $1.60 held for a "Hello", which refused an account with $0.90 left. 16,000 is
 * still far more than a turn needs. DEVSTATION_MAX_TOKENS raises it.
 */
const DEFAULT_MAX_TOKENS = Number(process.env.DEVSTATION_MAX_TOKENS) || 16_000;

/** Below this a retry would produce a reply too short to be useful; better to
 *  say the balance is the problem. */
const MIN_RETRY_TOKENS = 1024;

/** OpenRouter's 402 says "…but can only afford 44192." Null when it does not. */
export function affordableTokens(detail: string): number | null {
  const match = /can only afford (\d+)/i.exec(detail);
  return match ? Number(match[1]) : null;
}

/** A failure a person can act on, instead of a truncated JSON dump. */
export function describeFailure(label: string, status: number, detail: string): string {
  let message = detail;
  try {
    const parsed = JSON.parse(detail) as {
      error?: { message?: string; metadata?: { raw?: string; provider_name?: string } };
    };
    if (parsed.error?.message) message = parsed.error.message;
    // OpenRouter's own message for an upstream failure is "Provider returned
    // error". The reason is in metadata.raw, and without it there is nothing
    // to act on.
    const raw = parsed.error?.metadata?.raw;
    if (raw) {
      let why = raw;
      try {
        const inner = JSON.parse(raw) as { error?: { message?: string }; message?: string };
        why = inner.error?.message ?? inner.message ?? raw;
      } catch {
        // Not JSON: the raw text is the reason.
      }
      message = `${message}: ${why}`;
    }
  } catch {
    // Not JSON: use the text as it is.
  }
  if (status === 402 && /credit/i.test(message)) {
    return (
      `${label} is out of credit for this request. Add credit at https://openrouter.ai/settings/credits, ` +
      "or use a cheaper model: devstation config set model anthropic/claude-sonnet-5"
    );
  }
  if (status === 401)
    return `${label} rejected the API key. Run \`devstation login\` to store a new one.`;
  return `${label} request failed (${status}). ${message.slice(0, 300)}`;
}

export interface OpenAiCompatibleOptions {
  /** "openrouter" (the default) or "openai" for any other compatible server:
   *  OpenAI itself, Ollama, LM Studio, Groq, Together. Only OpenRouter gets its
   *  attribution headers and its reasoning switch, which other servers either
   *  ignore or reject. */
  name?: "openrouter" | "openai";
  /** Up to, not including, `/chat/completions`. */
  baseUrl?: string;
}

interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

function stopReasonOf(raw: string | null | undefined): StopReason {
  switch (raw) {
    case "stop":
      return "end_turn";
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "other";
  }
}

function toOpenAiMessages(system: string, messages: ProviderMessage[]) {
  const out: Record<string, unknown>[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else {
      out.push({
        role: "assistant",
        content: m.content || null,
        ...(m.toolCalls?.length
          ? {
              tool_calls: m.toolCalls.map((c) => ({
                id: c.id,
                type: "function",
                function: { name: c.name, arguments: JSON.stringify(c.input) },
              })),
            }
          : {}),
      });
    }
  }
  return out;
}

/** Arguments arrive as a string and models vary their escaping, so this parses
 *  rather than pattern-matches, and treats unparseable arguments as empty
 *  instead of throwing. The schema check downstream gives the model a usable
 *  error, where an exception here would just end the turn. */
function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class OpenRouterProvider implements ModelProvider {
  readonly name: "openrouter" | "openai";
  readonly model: string;
  private readonly endpoint: string;

  /**
   * OpenRouter by default, and any OpenAI-compatible server when given a name
   * and an endpoint. One class, because the wire format is the same one: what
   * differs is the URL and two OpenRouter-only extras.
   */
  constructor(
    private readonly apiKey: string,
    model?: string,
    opts: OpenAiCompatibleOptions = {},
  ) {
    this.name = opts.name ?? "openrouter";
    const base = (opts.baseUrl || OPENROUTER_BASE).replace(/\/+$/, "");
    this.endpoint = `${base}/chat/completions`;
    this.model =
      model ||
      process.env.AI_MODEL ||
      (this.name === "openrouter" ? "anthropic/claude-sonnet-5" : "");
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const openRouter = this.name === "openrouter";
    const send = (maxTokens: number) =>
      fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // A local server needs no key, and some reject an empty bearer.
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
          ...(openRouter
            ? { "HTTP-Referer": "https://devstation.online", "X-Title": "DevStation" }
            : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: toOpenAiMessages(input.system, input.messages),
          stream: true,
          max_tokens: maxTokens,
          temperature: 0.2,
          ...(input.tools?.length
            ? {
                tools: input.tools.map((t) => ({
                  type: "function",
                  function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.inputSchema,
                  },
                })),
              }
            : {}),
          // Reasoning deltas carry no content, and a long reasoning burst looks
          // exactly like a hang.
          ...(openRouter && process.env.AI_REASONING !== "on"
            ? { reasoning: { enabled: false } }
            : {}),
        }),
        signal: input.signal,
      });

    const label = openRouter ? "OpenRouter" : `The endpoint ${this.endpoint}`;
    const requested = input.maxTokens ?? DEFAULT_MAX_TOKENS;
    let res = await send(requested);

    // OpenRouter holds credit for the whole max_tokens before it answers. A
    // balance that easily covers the real reply can still be refused because it
    // does not cover the ceiling -- and the refusal says exactly what does fit.
    // One retry inside that, never a loop.
    if (res.status === 402 && openRouter) {
      const detail = await res.text().catch(() => "");
      const afford = affordableTokens(detail);
      if (afford !== null && afford >= MIN_RETRY_TOKENS && afford < requested) {
        res = await send(Math.floor(afford * 0.95));
      } else {
        throw new Error(describeFailure(label, res.status, detail));
      }
    }

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(describeFailure(label, res.status, detail));
    }

    let text = "";
    let finish: string | null = null;
    const usage = { ...EMPTY_USAGE };
    // Accumulated by index, because arguments arrive in fragments that are only
    // valid JSON once the whole call has been delivered.
    const partial = new Map<number, OpenAiToolCall>();

    let buffer = "";
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string; tool_calls?: Array<OpenAiToolCall & { index: number }> };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          const choice = chunk.choices?.[0];
          const delta = choice?.delta?.content;
          if (delta) {
            text += delta;
            input.onDelta?.(delta);
          }
          for (const call of choice?.delta?.tool_calls ?? []) {
            const existing = partial.get(call.index) ?? {
              id: call.id ?? `call_${call.index}`,
              type: "function" as const,
              function: { name: "", arguments: "" },
            };
            if (call.id) existing.id = call.id;
            if (call.function?.name) existing.function.name = call.function.name;
            if (call.function?.arguments) existing.function.arguments += call.function.arguments;
            partial.set(call.index, existing);
          }
          if (choice?.finish_reason) finish = choice.finish_reason;
          if (chunk.usage) {
            usage.inputTokens = chunk.usage.prompt_tokens ?? 0;
            usage.outputTokens = chunk.usage.completion_tokens ?? 0;
          }
        } catch {
          /* keep-alive comments and partial frames are normal */
        }
      }
    }

    const toolCalls: ProviderToolCall[] = [...partial.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, c]) => ({
        id: c.id,
        name: c.function.name,
        input: parseArguments(c.function.arguments),
      }));

    return {
      text,
      toolCalls,
      stopReason: toolCalls.length ? "tool_use" : stopReasonOf(finish),
      model: this.model,
      usage,
    };
  }
}
