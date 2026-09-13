import { describe, expect, it } from "bun:test";
import { composerView, footerLine, messageBlock, visibleLength } from "./composer";

describe("the input row", () => {
  it("is the prompt and what has been typed, with the cursor after it", () => {
    const view = composerView({ prompt: "› ", line: "hello", cursor: 5, columns: 80 });
    expect(view.text).toBe("› hello");
    expect(view.column).toBe(7);
  });

  it("says a paste is waiting instead of spilling it across the screen", () => {
    const view = composerView({ prompt: "› ", line: "", cursor: 0, columns: 80, pastedLines: 32 });
    expect(view.text).toBe("› [Pasted 32 lines] ");
  });

  it("scrolls a long line so the cursor stays on screen", () => {
    const line = "x".repeat(200);
    const view = composerView({ prompt: "› ", line, cursor: 200, columns: 40 });
    expect(visibleLength(view.text)).toBeLessThanOrEqual(40);
    expect(view.column).toBeLessThan(40);
  });
});

describe("a sent message", () => {
  it("stands apart with a marker", () => {
    expect(messageBlock("build a tip jar", 80)).toBe("\n › build a tip jar\n");
  });

  it("shortens a long paste to its first lines", () => {
    const text = Array.from({ length: 32 }, (_, i) => `line ${i + 1}`).join("\n");
    const block = messageBlock(text, 80, false, 8).trim().split("\n");
    expect(block).toHaveLength(8);
    expect(block[0]).toBe("› line 1");
    expect(block[7]).toContain("… +25 more lines");
  });

  it("fills the width with a shaded band when there is colour", () => {
    const block = messageBlock("hi", 30, true);
    expect(block).toContain("[48;5;236m");
    expect(visibleLength(block.split("\n")[1])).toBe(30);
  });
});

describe("the footer", () => {
  it("shows the mode, model, folder and how to change things", () => {
    const text = footerLine(
      { mode: "auto", model: "anthropic/claude-opus-5", path: "~/gencontract", costUsd: 0.42 },
      120,
    );
    expect(text).toBe(
      " ⏵⏵ auto mode · anthropic/claude-opus-5 · ~/gencontract · $0.42 · / commands · shift+tab mode",
    );
  });

  it("leaves the cost out until there is one, and fits a narrow terminal", () => {
    expect(footerLine({ mode: "normal", model: "m", path: "~" }, 120)).not.toContain("$");
    const narrow = footerLine({ mode: "plan", model: "anthropic/claude-opus-5", path: "~/x" }, 30);
    expect(narrow.length).toBeLessThanOrEqual(30);
    expect(narrow).toContain("⏸ plan mode");
  });
});
