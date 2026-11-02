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
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";

/** Streaming is on, so this can be generous: the low ceiling exists to dodge
 *  HTTP timeouts on non-streaming calls, which is not the case here. */
const DEFAULT_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS ?? 64_000);

/** Agentic coding: `high` balances quality against spend on the current
 *  models (Claude Opus 5.5 would otherwise default to `medium`). */
const EFFORT = (process.env.ANTHROPIC_EFFORT || "high") as
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
      const pictures = (message.images ?? [])
        .map((url) => /^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/.exec(url))
        .filter((m): m is RegExpExecArray => m !== null);
      out.push({
        role: "user",
        content: pictures.length
          ? [
              ...pictures.map((m) => ({
                type: "image" as const,
                source: {
                  type: "base64" as const,
                  media_type: m[1] as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                  data: m[2],
                },
              })),
              { type: "text" as const, text: message.content },
            ]
          : message.content,
      });
      continue;
    }

    // The turn exactly as the model produced it, thinking blocks included:
    // they must come back unchanged for the model to keep its reasoning
    // across tool calls. Only present within one run (see orchestrator).
    if (message.raw?.length) {
      out.push({ role: "assistant", content: message.raw as Anthropic.ContentBlockParam[] });
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
    // On the models that write their between-tool-call notes as thinking
    // blocks, ask for those notes ("updates"): they are the narration the
    // person reads while the agent works, and empty by default.
    const updates = UPDATES_MODELS.test(this.model);
    const stream = this.client.beta.messages.stream(
      {
        model: this.model,
        max_tokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
        // The system prompt and the tool list are byte-identical every turn,
        // which is exactly the prefix worth caching; the top-level breakpoint
        // also caches the conversation so far, which a tool loop resends on
        // every call.
        system: [{ type: "text", text: input.system, cache_control: { type: "ephemeral" } }],
        cache_control: { type: "ephemeral" },
        thinking: updates ? { type: "adaptive", display: "updates" } : { type: "adaptive" },
        output_config: { effort: EFFORT },
        ...(updates ? { betas: ["thinking-display-updates-2026-08-18"] } : {}),
        messages: toAnthropicMessages(input.messages) as Anthropic.Beta.BetaMessageParam[],
        ...(input.tools?.length
          ? {
              tools: input.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      } as unknown as Anthropic.Beta.Messages.MessageCreateParamsStreaming,
      { signal: input.signal },
    );

    if (input.onDelta) stream.on("text", (chunk: string) => input.onDelta?.(chunk));
    if (input.onThinking) {
      stream.on("thinking", (chunk: string) => input.onThinking?.(chunk.length));
    }

    const message = await stream.finalMessage();

    let text = "";
    const notes: string[] = [];
    const toolCalls: ProviderToolCall[] = [];
    for (const block of message.content as unknown as Array<
      { type: string } & Record<string, unknown>
    >) {
      if (block.type === "text") text += String(block.text ?? "");
      else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking) {
        notes.push(block.thinking);
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: String(block.id),
          name: String(block.name),
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      // The progress notes stand in for prose when the turn has none.
      text: text || notes.join("\n").trim(),
      toolCalls,
      stopReason: stopReasonOf(message.stop_reason),
      model: message.model,
      raw: message.content as unknown[],
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

/** Models whose text between tool calls arrives as progress-update thinking
 *  blocks (Claude API reference, 2026-10). */
const UPDATES_MODELS = /claude-(opus-5-5|sonnet-5-5|fable-5(-1)?)/;
