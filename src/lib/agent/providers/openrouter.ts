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

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

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
  readonly name = "openrouter";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model?: string,
  ) {
    this.model = model || process.env.AI_MODEL || "anthropic/claude-sonnet-5";
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://devstation.online",
        "X-Title": "DevStation",
      },
      body: JSON.stringify({
        model: this.model,
        messages: toOpenAiMessages(input.system, input.messages),
        stream: true,
        max_tokens: input.maxTokens ?? 64_000,
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
        ...(process.env.AI_REASONING === "on" ? {} : { reasoning: { enabled: false } }),
      }),
      signal: input.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenRouter request failed (${res.status}). ${detail.slice(0, 200)}`);
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
