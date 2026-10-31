import { describe, expect, it } from "bun:test";
import { splitSuggestions } from "./suggestions";

describe("suggestions in a reply", () => {
  it("lifts the closing list out of the reply", () => {
    const r = splitSuggestions(
      "Built the dashboard.\n\nSuggestions:\n- Add a dark mode\n- Write end-to-end tests\n- Deploy to Vercel",
    );
    expect(r.body).toBe("Built the dashboard.");
    expect(r.suggestions).toEqual([
      "Add a dark mode",
      "Write end-to-end tests",
      "Deploy to Vercel",
    ]);
  });

  it("accepts a bold heading and numbered items, and keeps at most three", () => {
    const r = splitSuggestions("Done.\n**Suggestions:**\n1. One\n2. **Two**\n3. Three\n4. Four");
    expect(r.suggestions).toEqual(["One", "Two", "Three"]);
  });

  it("leaves a reply alone when the list is not the ending", () => {
    const text = "Suggestions:\n- one\n\nAnd then more prose.";
    expect(splitSuggestions(text)).toEqual({ body: text, suggestions: [] });
    expect(splitSuggestions("Hello there.").suggestions).toEqual([]);
  });
});
