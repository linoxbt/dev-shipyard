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
  // Anthropic list prices, checked against the Claude API reference on
  // 2026-10-31 (cache writes are the 5-minute rate, 1.25x input). Prices
  // change: re-check rather than trusting these; AGENT_*_COST overrides them.
  {
    match: /fable-5[.-]1|mythos/i,
    rates: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  },
  { match: /fable/i, rates: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 } },
  { match: /opus-5[.-]5/i, rates: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } },
  { match: /opus/i, rates: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 } },
  {
    match: /haiku-5[.-]5/i,
    rates: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  },
  { match: /haiku/i, rates: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 } },
  {
    match: /sonnet-5[.-]5|sonnet-5\b|sonnet-5$/i,
    rates: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  },
  { match: /sonnet/i, rates: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  // Qwen 3.8 27B, the free default on Fortytwo. Fortytwo publishes no rate of
  // its own; this is Alibaba Cloud's first-party price (October 2026). Without
  // it, the default model was priced at the dearest row: its costs read about
  // twenty times too high and its per-turn budget ran out early.
  {
    match: /^auto$|qwen-?3\.8-27b|qwen3\.8-27b/i,
    rates: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5 },
  },
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
  const known = TABLE.find((entry) => entry.match.test(model))?.rates;
  // The overrides price models the table does not know (a self-hosted or new
  // model); a listed model keeps its list price, so an override meant for one
  // model cannot quietly under-price every other.
  if (known) return known;
  const base =
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
  // The provider's own figure wins: it knows the model's real price, which the
  // table only approximates (and does not list at all for most non-Claude
  // models, which fall to the dearest row).
  if (typeof usage.costUsd === "number" && Number.isFinite(usage.costUsd)) return usage.costUsd;
  return (
    (usage.inputTokens / 1e6) * rates.input +
    (usage.outputTokens / 1e6) * rates.output +
    (usage.cacheReadTokens / 1e6) * rates.cacheRead +
    (usage.cacheWriteTokens / 1e6) * rates.cacheWrite
  );
}
