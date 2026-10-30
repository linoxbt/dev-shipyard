import { describe, expect, it } from "bun:test";
import { providerForModel } from "./index";

describe("providerForModel", () => {
  it("runs Claude models on the Anthropic key, everything else on OpenRouter", () => {
    const both = { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" };
    const opus = providerForModel("opus-5.5", both);
    expect("provider" in opus && opus.provider.name).toBe("anthropic");
    const gpt = providerForModel("gpt-6.1-sol", both);
    expect("provider" in gpt && gpt.provider.name).toBe("openrouter");
  });

  it("says plainly when the runner cannot serve the model picked", () => {
    const r = providerForModel("gemini-4-argon", { ANTHROPIC_API_KEY: "a" });
    expect("problem" in r && r.problem).toContain("Gemini 4 Argon is not available");
  });

  it("runs Qwen on Fortytwo, and only with a Fortytwo key", () => {
    const qwen = providerForModel("qwen-3.8-27b", {
      FORTYTWO_API_KEY: "f",
      OPENROUTER_API_KEY: "o",
    });
    expect("provider" in qwen && qwen.provider.name).toBe("fortytwo");
    const none = providerForModel("qwen-3.8-27b", {
      ANTHROPIC_API_KEY: "a",
      OPENROUTER_API_KEY: "o",
    });
    expect("problem" in none && none.problem).toContain("needs a Fortytwo key");
  });

  it("refuses a model that is not on offer, and uses the default for Auto", () => {
    expect("problem" in providerForModel("made-up", { OPENROUTER_API_KEY: "o" })).toBe(true);
    expect("provider" in providerForModel("auto", { OPENROUTER_API_KEY: "o" })).toBe(true);
  });
});
