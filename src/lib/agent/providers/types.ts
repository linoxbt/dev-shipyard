// One interface the orchestrator talks to, three implementations behind it.
//
// The shapes here are deliberately neutral rather than Anthropic's own types.
// Anthropic's SDK types are the right thing to use *inside* AnthropicProvider,
// and that is what it does — but the boundary has to be something OpenRouter
// and a scripted test double can also satisfy, and a boundary typed in one
// vendor's shapes is not an abstraction.

/** A tool the model asked to run. `input` is already parsed from JSON: models
 *  vary their escaping, so string-matching the serialised form is a trap. */
export interface ProviderToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/**
 * One turn of the conversation.
 *
 * `tool` is its own role here even though Anthropic has no such role, because
 * the orchestrator thinks in terms of "this was a tool result". Mapping it onto
 * whatever the provider actually wants is the provider's job, and getting that
 * mapping wrong is the classic way these ports break.
 */
export type ProviderMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ProviderToolCall[] }
  | { role: "tool"; toolCallId: string; content: string; isError?: boolean };

/** A tool as the model is told about it. */
export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** What a turn cost. Kept on every result so cost accounting is a matter of
 *  summing something that already exists, rather than a later retrofit. */
export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  /** Served from cache, billed at roughly a tenth of the input rate. */
  cacheReadTokens: number;
  /** Written to cache, billed at slightly more than the input rate. */
  cacheWriteTokens: number;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface ProviderResult {
  /** Prose the model wrote, with tool calls excluded. */
  text: string;
  toolCalls: ProviderToolCall[];
  stopReason: StopReason;
  usage: ProviderUsage;
  /** Which model actually answered. Not always the one asked for: a refusal
   *  fallback can route the turn elsewhere. */
  model: string;
}

export interface GenerateInput {
  system: string;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  signal?: AbortSignal;
  /** Prose as it arrives, so the UI reads as the model thinks rather than
   *  sitting on a spinner. */
  onDelta?: (chunk: string) => void;
  maxTokens?: number;
}

export interface ModelProvider {
  /** For logs and events. Never used to branch on behaviour: that is what
   *  having an interface is for. */
  readonly name: string;
  readonly model: string;
  generate(input: GenerateInput): Promise<ProviderResult>;
}

export const EMPTY_USAGE: ProviderUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: ProviderUsage, b: ProviderUsage): ProviderUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}
