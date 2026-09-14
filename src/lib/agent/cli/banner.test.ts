import { describe, expect, it } from "bun:test";
import { banner, openingHelp, shortPath, wordmark, WORDMARK_WIDTH } from "./banner";

const ESC = String.fromCharCode(27);

describe("the wordmark", () => {
  it("is rectangular, so no row can drift", () => {
    // Built from a grid rather than pasted in as art, which is the point:
    // hand-written block letters lose a column and nobody sees until it is on
    // somebody's screen.
    const rows = wordmark();
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.length).toBe(WORDMARK_WIDTH);
  });

  it("fits a standard terminal", () => {
    expect(WORDMARK_WIDTH).toBeLessThanOrEqual(72);
  });

  it("draws something in every row", () => {
    for (const row of wordmark()) expect(row.trim().length).toBeGreaterThan(0);
  });
});

describe("the banner", () => {
  const facts = { model: "anthropic/claude-opus-5", workspace: "/home/me/project" };

  it("shows the model and where it is working", () => {
    const text = banner(facts, { columns: 100 });
    expect(text).toContain("claude-opus-5");
    expect(text).toContain("project");
    expect(text).toContain("the coding agent");
  });

  it("says plainly when there is no model", () => {
    expect(banner({ ...facts, model: null }, { columns: 100 })).toContain("no model configured");
  });

  it("drops the art when the terminal is too narrow for it", () => {
    const narrow = banner(facts, { columns: 40 });
    expect(narrow).not.toContain("█");
    expect(narrow).toContain("devstation");
    // Every line still fits.
    for (const line of narrow.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
  });

  it("treats a terminal reporting zero columns as unknown, not as tiny", () => {
    // A pty with no window size set reports 0. `??` let that through and gave
    // everyone the cramped banner.
    expect(banner(facts, { columns: 0 })).toContain("█");
  });

  it("wraps the details rather than running off the edge", () => {
    const text = banner(
      { ...facts, indexed: 3711, memory: 12, workspace: "/home/me/a/very/long/path/to/a/project" },
      { columns: 60 },
    );
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(60);
  });

  it("wraps the opening hints between phrases, never mid-word", () => {
    const lines = openingHelp(false, 87).trimEnd().split("\n");
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(85);
    expect(lines).toContain("  /exit leaves.");
    expect(lines.some((line) => line.startsWith("  Type / for commands · Shift+Tab"))).toBe(true);
    // A wide terminal keeps the hints on one line.
    expect(openingHelp(false, 140).trimEnd().split("\n")).toHaveLength(2);
  });

  it("leaves out counts it does not have", () => {
    const text = banner(facts, { columns: 100 });
    expect(text).not.toContain("chunks indexed");
    expect(text).not.toContain("notes");
  });

  it("emits no escape codes when colour is off", () => {
    const plain = banner({ ...facts, indexed: 10 }, { columns: 100, colour: false });
    expect(plain).not.toContain(ESC);
    expect(openingHelp(false)).not.toContain(ESC);
  });

  it("emits them when it is on", () => {
    expect(banner(facts, { columns: 100, colour: true })).toContain(ESC);
  });
});

describe("shortening a path", () => {
  it("uses ~ for home", () => {
    expect(shortPath("/home/me/project", "/home/me")).toBe("~/project");
    expect(shortPath("/home/me", "/home/me")).toBe("~");
  });

  it("leaves anything else alone", () => {
    expect(shortPath("/srv/app", "/home/me")).toBe("/srv/app");
    // A path that merely starts with the same letters is not inside home.
    expect(shortPath("/home/meredith/x", "/home/me")).toBe("/home/meredith/x");
  });
});
