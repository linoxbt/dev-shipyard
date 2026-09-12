import Anthropic from "@anthropic-ai/sdk";
import {
  EMPTY_USAGE,
  type GenerateInput,
  type ModelProvider,
  type ProviderMessage,
  type ProviderResult,
  type ProviderToolCall,
  type StopReason,
} from "./types";

// The Anthropic implementation, written against the official SDK rather than
// hand-rolled fetch.
//
// That choice removes most of what a hand-rolled client would have to get
// right: streaming accumulates `input_json_delta` fragments and parses each
// tool input only once its block closes, and 429/529 are retried with backoff.
// Hand-parsing SSE to reach the same place is a lot of code whose only
// distinction is being ours.
//
// Two details here are the ones that break naive ports, and both are load
// bearing:
//
//   1. There is no "tool" role. A tool result is a `user` message carrying
//      `tool_result` blocks.
//   2. Every result for one assistant turn goes in ONE user message, in the
//      order the calls were made. Splitting them across several messages
//      teaches the model to stop making parallel calls at all.

/** The model the build spec names. Overridable, because which model this runs
 *  on is a cost decision and therefore the operator's, not this file's. */
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

/** Streaming is on, so this can be generous: the low ceiling exists to dodge
 *  HTTP timeouts on non-streaming calls, which is not the case here. */
const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 64_000);

/** Coding and long-horizon agent work is where effort actually pays; this is
 *  the level meant for it. */
const EFFORT = (process.env.ANTHROPIC_EFFORT || "xhigh") as
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

function stopReasonOf(raw: string | null): StopReason {
  switch (raw) {
    case "end_turn":
    case "tool_use":
    case "max_tokens":
    case "refusal":
      return raw;
    default:
      return "other";
  }
}

/**
 * Fold our message list into Anthropic's.
 *
 * Runs of consecutive tool results collapse into a single user message. That
 * is the whole reason this is a fold rather than a map.
 */
export function toAnthropicMessages(messages: ProviderMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pendingResults: Anthropic.ToolResultBlockParam[] = [];

  const flush = () => {
    if (pendingResults.length === 0) return;
    out.push({ role: "user", content: pendingResults });
    pendingResults = [];
  };

  for (const message of messages) {
    if (message.role === "tool") {
      pendingResults.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        // A failed tool still gets a result block. Dropping it leaves the
        // model waiting for an answer that never comes.
        ...(message.isError ? { is_error: true } : {}),
      });
      continue;
    }

    flush();

    if (message.role === "user") {
      out.push({ role: "user", content: message.content });
      continue;
    }

    const blocks: Anthropic.ContentBlockParam[] = [];
    if (message.content) blocks.push({ type: "text", text: message.content });
    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.input });
    }
    // An assistant turn with neither prose nor calls would be rejected as
    // empty content; skip it rather than send it.
    if (blocks.length > 0) out.push({ role: "assistant", content: blocks });
  }

  flush();
  return out;
}

export class AnthropicProvider implements ModelProvider {
  readonly name = "anthropic";
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string; baseUrl?: string } = {}) {
    // A bare constructor resolves ANTHROPIC_API_KEY, or an `ant auth login`
    // profile, on its own. Passing undefined explicitly keeps that behaviour.
    // baseUrl is for a proxy or gateway that speaks the Anthropic API.
    this.client = new Anthropic({
      ...(opts.apiKey ? { apiKey: opts.apiKey } : {}),
      ...(opts.baseUrl ? { baseURL: opts.baseUrl } : {}),
    });
    this.model = opts.model || DEFAULT_MODEL;
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const stream = this.client.messages.stream(
      {
        model: this.model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        // The system prompt and the tool list are byte-identical every turn,
        // which is exactly the prefix worth caching. Volatile content lives in
        // messages, after this breakpoint.
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT },
        messages: toAnthropicMessages(input.messages),
        ...(input.tools?.length
          ? {
              tools: input.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      { signal: input.signal },
    );

    if (input.onDelta) stream.on("text", (chunk: string) => input.onDelta?.(chunk));

    const message = await stream.finalMessage();

    let text = "";
    const toolCalls: ProviderToolCall[] = [];
    for (const block of message.content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      stopReason: stopReasonOf(message.stop_reason),
      model: message.model,
      usage: {
        ...EMPTY_USAGE,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
