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
  // Checked against OpenRouter's live model list on 2026-09-13, which matches
  // Anthropic's list prices. The first version of this table was written from
  // memory and charged Opus 5 and Sonnet 5 about three times what they cost, so
  // every displayed cost and every --budget stop was inflated threefold. Prices
  // change: re-check rather than trusting these, and AGENT_*_COST overrides
  // them without a code change.
  { match: /fable-5[.-]1/i, rates: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 } },
  { match: /fable/i, rates: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
  { match: /opus/i, rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  { match: /haiku/i, rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  { match: /sonnet/i, rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 } },
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
