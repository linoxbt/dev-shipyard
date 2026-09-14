import { describe, expect, it } from "bun:test";
import { boxLines, composerView, footerLine, messageBlock, visibleLength } from "./composer";

describe("the input line", () => {
  it("is the prompt and what has been typed, with the cursor after it", () => {
    const view = composerView({ prompt: "❯ ", line: "hello", cursor: 5, columns: 80 });
    expect(view.text).toBe("❯ hello");
    expect(view.column).toBe(7);
  });

  it("says a paste is waiting instead of spilling it across the screen", () => {
    const view = composerView({ prompt: "❯ ", line: "", cursor: 0, columns: 80, pastedLines: 32 });
    expect(view.text).toBe("❯ [Pasted 32 lines] ");
  });

  it("scrolls a long line so the cursor stays on screen", () => {
    const view = composerView({ prompt: "❯ ", line: "x".repeat(200), cursor: 200, columns: 40 });
    expect(visibleLength(view.text)).toBeLessThanOrEqual(40);
    expect(view.column).toBeLessThan(40);
  });
});

describe("the input box", () => {
  it("is a rule, the prompt, a rule and the footer", () => {
    const lines = boxLines({ input: "❯ hi", footer: "  footer", columns: 21 });
    expect(lines).toEqual(["─".repeat(20), "❯ hi", "─".repeat(20), "  footer"]);
  });

  it("carries a title on the right of the top rule, and the command list under it", () => {
    const lines = boxLines({
      input: "❯ /",
      footer: "f",
      columns: 41,
      title: "gencontract",
      menu: ["  /new", "  /resume"],
    });
    expect(lines[0].endsWith(" gencontract ─")).toBe(true);
    expect(lines[0]).toHaveLength(40);
    expect(lines.slice(4)).toEqual(["  /new", "  /resume"]);
  });
});

describe("a sent message", () => {
  it("stands apart with a marker", () => {
    expect(messageBlock("build a tip jar", 80)).toBe("\n ❯ build a tip jar\n");
  });

  it("shortens a long paste to its first lines", () => {
    const text = Array.from({ length: 32 }, (_, i) => `line ${i + 1}`).join("\n");
    const block = messageBlock(text, 80, false, 8).trim().split("\n");
    expect(block).toHaveLength(8);
    expect(block[0]).toBe("❯ line 1");
    expect(block[7]).toContain("… +25 more lines");
  });

  it("fills the width with a shaded band when there is colour", () => {
    const block = messageBlock("hi", 30, true);
    expect(block).toContain("[48;5;236m");
    expect(visibleLength(block.split("\n")[1])).toBe(30);
  });
});

describe("the footer", () => {
  it("puts the mode on the left and the model, folder and cost on the right", () => {
    const text = footerLine(
      { mode: "auto", model: "anthropic/claude-opus-5", path: "~/gencontract", costUsd: 0.42 },
      100,
    );
    expect(text.startsWith("  ⏵⏵ auto mode on (shift+tab to cycle)")).toBe(true);
    expect(text.endsWith("anthropic/claude-opus-5 · ~/gencontract · $0.42")).toBe(true);
    expect(text).toHaveLength(99);
  });

  it("says how to get started in normal mode, and drops the right side when narrow", () => {
    expect(footerLine({ mode: "normal", model: "m", path: "~" }, 100)).toContain(
      "/ for commands · shift+tab to cycle modes",
    );
    const narrow = footerLine({ mode: "plan", model: "anthropic/claude-opus-5", path: "~/x" }, 40);
    expect(narrow).toBe("  ⏸ plan mode on (shift+tab to cycle)");
  });
});
