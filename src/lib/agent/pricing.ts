import type { ProviderUsage } from "./providers";

// What a run actually costs.
//
// This is not a display concern. `maxCostUsd` stops a run when the spend
// reaches a limit, so a cost that reads low is a budget that does not hold.
// Two things were wrong with the flat pair of constants this replaces.
//
// Cache WRITES were never priced. The Anthropic provider marks the system
// block `ephemeral`, so caching is on and cache-creation tokens are really
// produced; they were collected, summed, and then multiplied by nothing.
// Anthropic bills them at 1.25x the input rate.
//
// And one rate was applied to every model. The provider and model are
// configurable, and Opus costs several times Sonnet, so a budget expressed in
// dollars was wrong for anything but the model the constants were written for.

export interface Rates {
  /** USD per million tokens. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Published rates per million tokens.
 *
 * Matched on a substring rather than an exact id because the same model
 * arrives spelled several ways: `claude-sonnet-5`, `anthropic/claude-sonnet-5`
 * through OpenRouter, and dated variants. The first match wins, so the more
 * specific entries come first.
 */
const TABLE: Array<{ match: RegExp; rates: Rates }> = [
  { match: /opus/i, rates: { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 } },
  { match: /haiku/i, rates: { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 } },
  { match: /sonnet/i, rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
];

/**
 * The rates a budget should be measured against.
 *
 * An unknown model gets the most expensive entry in the table, not an average
 * and not a cheap default. Under-charging an unrecognised model is how a
 * budget silently stops holding; over-charging one only stops a run early,
 * with a message saying why.
 */
export function ratesFor(model: string, env: NodeJS.ProcessEnv = process.env): Rates {
  const override: Partial<Rates> = {
    input: env.AGENT_INPUT_COST ? Number(env.AGENT_INPUT_COST) : undefined,
    output: env.AGENT_OUTPUT_COST ? Number(env.AGENT_OUTPUT_COST) : undefined,
    cacheRead: env.AGENT_CACHE_READ_COST ? Number(env.AGENT_CACHE_READ_COST) : undefined,
    cacheWrite: env.AGENT_CACHE_WRITE_COST ? Number(env.AGENT_CACHE_WRITE_COST) : undefined,
  };
  const base =
    TABLE.find((entry) => entry.match.test(model))?.rates ??
    // The dearest row. See above.
    TABLE.reduce((a, b) => (a.rates.output >= b.rates.output ? a : b)).rates;

  return {
    input: override.input ?? base.input,
    output: override.output ?? base.output,
    cacheRead: override.cacheRead ?? base.cacheRead,
    cacheWrite: override.cacheWrite ?? base.cacheWrite,
  };
}

export function costOfUsage(usage: ProviderUsage, rates: Rates): number {
  return (
    (usage.inputTokens / 1e6) * rates.input +
    (usage.outputTokens / 1e6) * rates.output +
    (usage.cacheReadTokens / 1e6) * rates.cacheRead +
    (usage.cacheWriteTokens / 1e6) * rates.cacheWrite
  );
}
