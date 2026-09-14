import { describe, expect, it } from "bun:test";
import { boxLines, composerView, footerLine, messageBlock, visibleLength } from "./composer";
import { displayWidth, fitWidth } from "./width";

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
    expect(visibleLength(block.split("\n")[1])).toBe(29);
  });

  it("never runs past the edge, whatever the paste holds", () => {
    const text = [
      "Build this as an intelligent contract, check provenance folder for insights. disregard all",
      "# 1️⃣ GenContract – AI‑Powered Legal‑Contract Builder & Enforcer 合同 🚀🚀🚀🚀🚀🚀🚀🚀🚀🚀",
    ].join("\n");
    for (const colour of [false, true]) {
      for (const row of messageBlock(text, 87, colour).split("\n")) {
        expect(displayWidth(row)).toBeLessThan(87);
      }
    }
  });
});

describe("width on screen", () => {
  it("counts emoji and CJK as two cells, and colour and joiners as none", () => {
    expect(displayWidth("abc")).toBe(3);
    expect(displayWidth("1️⃣")).toBe(2);
    expect(displayWidth("合同")).toBe(4);
    expect(displayWidth("🚀")).toBe(2);
    expect(displayWidth("\x1b[38;5;208m✳\x1b[0m hi")).toBe(4);
  });

  it("cuts to the width with an ellipsis, keeping colour codes and resetting them", () => {
    const cut = fitWidth("\x1b[90m🚀🚀🚀🚀 launch\x1b[0m", 6);
    expect(displayWidth(cut)).toBeLessThanOrEqual(6);
    expect(cut.startsWith("\x1b[90m🚀🚀")).toBe(true);
    expect(cut.endsWith("…\x1b[0m")).toBe(true);
    expect(fitWidth("short", 10)).toBe("short");
  });
});

describe("every line of the box fits the terminal", () => {
  it("even with wide characters in the input, the footer and the menu", () => {
    const columns = 60;
    const view = composerView({
      prompt: "❯ ",
      line: "合同".repeat(40),
      cursor: 80,
      columns,
    });
    expect(displayWidth(view.text)).toBeLessThan(columns - 1);
    expect(view.column).toBeLessThan(columns - 1);
    const lines = boxLines({
      input: view.text,
      footer: footerLine(
        { mode: "auto", model: "openrouter/anthropic/claude-opus-5", path: "~/a/long/folder" },
        columns,
      ),
      columns,
      menu: ["  /resume ".padEnd(70, "x")],
    });
    // The rules run to one cell short of the edge; nothing else reaches that far.
    for (const line of lines) expect(displayWidth(line)).toBeLessThanOrEqual(columns - 1);
    expect(displayWidth(lines[1])).toBeLessThan(columns - 1);
    expect(displayWidth(lines[3])).toBeLessThan(columns - 2);
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
    expect(text).toHaveLength(97);
  });

  it("says how to get started in normal mode, and drops the right side when narrow", () => {
    expect(footerLine({ mode: "normal", model: "m", path: "~" }, 100)).toContain(
      "/ for commands · shift+tab to cycle modes",
    );
    const narrow = footerLine({ mode: "plan", model: "anthropic/claude-opus-5", path: "~/x" }, 40);
    expect(narrow).toBe("  ⏸ plan mode on (shift+tab to cycle)");
  });
});
