import { describe, expect, it } from "bun:test";
import { costOfUsage, ratesFor } from "./pricing";
import { EMPTY_USAGE } from "./providers";

// A budget is only as honest as the arithmetic behind it.

describe("what a run is charged", () => {
  it("prices cache writes, which used to be free", () => {
    // The bug: cacheWriteTokens were collected from the provider, summed, and
    // multiplied by nothing, so every run that used prompt caching -- which is
    // every Anthropic run, the system block is marked ephemeral -- reported
    // less than it spent, and maxCostUsd let it run past the limit.
    const rates = ratesFor("claude-sonnet-5");
    const withWrites = costOfUsage({ ...EMPTY_USAGE, cacheWriteTokens: 1_000_000 }, rates);
    expect(withWrites).toBeGreaterThan(0);
    // Anthropic bills cache creation above the input rate, not below it.
    expect(withWrites).toBeGreaterThan(
      costOfUsage({ ...EMPTY_USAGE, inputTokens: 1_000_000 }, rates),
    );
  });

  it("charges a dearer model more", () => {
    const usage = { ...EMPTY_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 };
    const sonnet = costOfUsage(usage, ratesFor("claude-sonnet-5"));
    const opus = costOfUsage(usage, ratesFor("claude-opus-5"));
    const haiku = costOfUsage(usage, ratesFor("claude-haiku-4-5-20251001"));
    expect(opus).toBeGreaterThan(sonnet);
    expect(sonnet).toBeGreaterThan(haiku);
  });

  it("recognises a model however it is spelled", () => {
    expect(ratesFor("anthropic/claude-sonnet-5")).toEqual(ratesFor("claude-sonnet-5"));
    expect(ratesFor("claude-opus-5")).toEqual(ratesFor("some-vendor/CLAUDE-OPUS-5-20260101"));
  });

  it("charges an unknown model at the dearest rate, not the cheapest", () => {
    // Guessing low on something unrecognised is how a budget silently stops
    // holding. Guessing high only ends a run early, with a reason.
    const usage = { ...EMPTY_USAGE, outputTokens: 1_000_000 };
    expect(costOfUsage(usage, ratesFor("who-knows-3"))).toBe(
      costOfUsage(usage, ratesFor("claude-fable-5.1")),
    );
  });

  it("lets an operator price a model the table does not list", () => {
    const env = { AGENT_OUTPUT_COST: "99" } as NodeJS.ProcessEnv;
    const rates = ratesFor("self-hosted-llm", env);
    expect(rates.output).toBe(99);
    // Only the one named is overridden.
    expect(rates.input).toBe(ratesFor("self-hosted-llm").input);
    // A listed model keeps its list price: an override meant for one model
    // must not under-price premium spend on every other.
    expect(ratesFor("claude-sonnet-5", env).output).toBe(10);
  });

  it("prices the current Claude models at their list prices", () => {
    expect(ratesFor("claude-opus-5-5")).toMatchObject({ input: 4, output: 20 });
    expect(ratesFor("anthropic/claude-sonnet-5.5")).toMatchObject({ input: 2, output: 10 });
    expect(ratesFor("claude-haiku-5-5")).toMatchObject({ input: 0.1, output: 0.5 });
    expect(ratesFor("claude-fable-5-1")).toMatchObject({ input: 10, output: 50 });
  });

  it("prefers the provider's own figure for what a call cost", () => {
    const usage = { ...EMPTY_USAGE, outputTokens: 1_000_000, costUsd: 0.42 };
    expect(costOfUsage(usage, ratesFor("openai/gpt-6.1-sol"))).toBe(0.42);
  });

  it("costs nothing for nothing", () => {
    expect(costOfUsage(EMPTY_USAGE, ratesFor("claude-sonnet-5"))).toBe(0);
  });
});
