import { describe, expect, test } from "bun:test";
import { diffLines, diffStats } from "./diff";

describe("diffLines", () => {
  test("identical text is all context, no add/del", () => {
    const ops = diffLines("a\nb\nc", "a\nb\nc");
    expect(ops.every((o) => o.type === "ctx")).toBe(true);
    expect(ops.map((o) => o.text)).toEqual(["a", "b", "c"]);
  });

  test("detects a single changed line as del+add around shared context", () => {
    const ops = diffLines("a\nb\nc", "a\nX\nc");
    expect(ops).toEqual([
      { type: "ctx", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "X" },
      { type: "ctx", text: "c" },
    ]);
  });

  test("pure insertion", () => {
    const ops = diffLines("a\nc", "a\nb\nc");
    expect(ops).toEqual([
      { type: "ctx", text: "a" },
      { type: "add", text: "b" },
      { type: "ctx", text: "c" },
    ]);
  });

  test("pure deletion", () => {
    const ops = diffLines("a\nb\nc", "a\nc");
    expect(ops).toEqual([
      { type: "ctx", text: "a" },
      { type: "del", text: "b" },
      { type: "ctx", text: "c" },
    ]);
  });

  test("empty old text is entirely additions", () => {
    const ops = diffLines("", "a\nb");
    expect(ops).toEqual([
      { type: "add", text: "a" },
      { type: "add", text: "b" },
    ]);
  });
});

describe("diffStats", () => {
  test("counts add/del, ignoring context", () => {
    const ops = diffLines("a\nb\nc", "a\nX\nY\nc");
    const stats = diffStats(ops);
    expect(stats.removed).toBe(1);
    expect(stats.added).toBe(2);
  });
});
