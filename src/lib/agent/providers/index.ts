import { AnthropicProvider } from "./anthropic";
import { EngineProvider } from "./engine";
import { OpenRouterProvider } from "./openrouter";
import type { ModelProvider } from "./types";
import type { Resolved } from "./settings";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { OpenRouterProvider } from "./openrouter";
export {
  ENGINE_BINARY,
  ENGINE_INSTALL,
  ENGINE_LABEL,
  ENGINE_SIGN_IN,
  EngineProvider,
  isEngineProvider,
} from "./engine";
export { MockProvider, type MockTurn } from "./mock";
export * from "./settings";

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
export function providerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  model?: string,
): ModelProvider | null {
  if (env.ANTHROPIC_API_KEY) return new AnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model });
  const openRouter = env.OPENROUTER_API_KEY || env.AI_API_KEY;
  if (openRouter) return new OpenRouterProvider(openRouter, model);
  return null;
}

/** Which provider would be chosen, without constructing one. For diagnostics
 *  and for telling a user why nothing is running. */
export function configuredProviderName(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.OPENROUTER_API_KEY || env.AI_API_KEY) return "openrouter";
  return null;
}

/**
 * Build the provider that resolveSettings chose.
 *
 * Kept apart from providerFromEnv on purpose. The runner and the benchmark use
 * the environment-only path and must keep behaving exactly as they did; only
 * the CLI reads files, because only a person at a terminal wants a settings
 * file and a login command.
 */
export function providerFromSettings(resolved: Resolved): ModelProvider | null {
  if (resolved.problem || !resolved.provider) return null;
  const model = resolved.model ?? undefined;
  const baseUrl = resolved.baseUrl ?? undefined;
  switch (resolved.provider) {
    case "anthropic":
      return new AnthropicProvider({ apiKey: resolved.apiKey ?? undefined, model, baseUrl });
    case "openrouter":
      return new OpenRouterProvider(resolved.apiKey ?? "", model, { name: "openrouter", baseUrl });
    case "openai":
      return new OpenRouterProvider(resolved.apiKey ?? "", model, {
        name: "openai",
        baseUrl: baseUrl ?? "https://api.openai.com/v1",
      });
    // Claude Code or Codex, signed in with the person's own subscription.
    case "claude-code":
    case "codex":
      return new EngineProvider(resolved.provider, model);
  }
}
