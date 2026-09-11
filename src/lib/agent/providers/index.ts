import { AnthropicProvider } from "./anthropic";
import { OpenRouterProvider } from "./openrouter";
import type { ModelProvider } from "./types";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { OpenRouterProvider } from "./openrouter";
export { MockProvider, type MockTurn } from "./mock";

/**
 * Pick a provider from the environment.
 *
 * Anthropic when there is a key for it, OpenRouter otherwise. Preferring
 * Anthropic is not a judgement about quality: it is the one whose client gives
 * prompt caching and native tool-calling, and on a long agent run caching is
 * the single largest cost lever available.
 *
 * Returns null rather than throwing when neither key is set, so a caller can
 * say "no model is configured" in its own words instead of catching.
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): ModelProvider | null {
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY });
  const openRouter = env.OPENROUTER_API_KEY || env.AI_API_KEY;
  if (openRouter) return new OpenRouterProvider(openRouter);
  return null;
}

/** Which provider would be chosen, without constructing one. For diagnostics
 *  and for telling a user why nothing is running. */
export function configuredProviderName(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENROUTER_API_KEY || env.AI_API_KEY) return "openrouter";
  return null;
}
