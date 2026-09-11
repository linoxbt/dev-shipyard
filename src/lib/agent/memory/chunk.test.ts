import { describe, expect, it } from "bun:test";
import { approxTokens, chunkFile, extensionOf } from "./chunk";

// What matters about a chunk is that it holds a whole thing, that its line
// numbers are right, and that nothing in the file goes missing. Those three
// are what make a retrieved chunk quotable as an answer.

const TS = `import { join } from "node:path";

const ROOT = "/srv";

/** Adds up the prices, applying quantity. */
export function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * (item.quantity ?? 1);
  }
  return sum;
}

export class Basket {
  constructor(items) {
    this.items = items;
  }

  value() {
    return total(this.items);
  }
}
`;

describe("chunking a brace language", () => {
  it("keeps a function whole, with its doc comment", () => {
    const chunks = chunkFile("src/total.ts", TS);
    const total = chunks.find((c) => c.name === "total");
    expect(total).toBeDefined();
    expect(total?.kind).toBe("declaration");
    expect(total?.text).toContain("Adds up the prices");
    expect(total?.text).toContain("return sum;");
    expect(total?.text).toContain("}");
  });

  it("keeps a class whole, including its methods", () => {
    const basket = chunkFile("src/total.ts", TS).find((c) => c.name === "Basket");
    expect(basket?.text).toContain("constructor(items)");
    expect(basket?.text).toContain("value()");
  });

  it("gives line numbers that point at the real lines", () => {
    const lines = TS.split("\n");
    for (const chunk of chunkFile("src/total.ts", TS)) {
      expect(chunk.text.split("\n")[0]).toBe(lines[chunk.startLine - 1]);
      expect(chunk.text.split("\n").at(-1)).toBe(lines[chunk.endLine - 1]);
    }
  });

  it("loses nothing: every non-blank line is in some chunk", () => {
    const chunks = chunkFile("src/total.ts", TS);
    const covered = new Set<number>();
    for (const chunk of chunks) {
      for (let i = chunk.startLine; i <= chunk.endLine; i++) covered.add(i);
    }
    TS.split("\n").forEach((line, index) => {
      if (line.trim() !== "") expect(covered.has(index + 1)).toBe(true);
    });
  });

  it("does not let a brace inside a string swallow the rest of the file", () => {
    const tricky = `export function a() {
  const s = "{{{";
  return s;
}

export function b() {
  return 2;
}
`;
    const names = chunkFile("x.ts", tricky).map((c) => c.name);
    expect(names).toContain("a");
    expect(names).toContain("b");
  });

  it("does not let a brace inside a comment swallow the rest either", () => {
    const tricky = `export function a() {
  // closing } here is not real
  /* nor { this one */
  return 1;
}

export function b() {
  return 2;
}
`;
    const chunks = chunkFile("x.ts", tricky);
    expect(chunks.find((c) => c.name === "a")?.text).not.toContain("function b");
    expect(chunks.map((c) => c.name)).toContain("b");
  });
});

describe("chunking Python", () => {
  const PY = `import os

CONST = 1

def total(items):
    return sum(i["price"] for i in items)

class Basket:
    def __init__(self, items):
        self.items = items

    def value(self):
        return total(self.items)
`;

  it("finds the top-level definitions", () => {
    const names = chunkFile("app.py", PY).map((c) => c.name);
    expect(names).toContain("total");
    expect(names).toContain("Basket");
  });

  it("keeps the methods with their class", () => {
    const basket = chunkFile("app.py", PY).find((c) => c.name === "Basket");
    expect(basket?.text).toContain("def value(self)");
  });

  it("still covers the imports and constants above the first definition", () => {
    const chunks = chunkFile("app.py", PY);
    expect(chunks.some((c) => c.text.includes("import os"))).toBe(true);
    expect(chunks.some((c) => c.text.includes("CONST = 1"))).toBe(true);
  });
});

describe("chunking markdown", () => {
  const MD = `Intro paragraph.

# Title

Some words.

## Setup

Run it.

## Usage

Call it.
`;

  it("splits on headings and names the section", () => {
    const chunks = chunkFile("README.md", MD);
    expect(chunks.map((c) => c.name)).toEqual([null, "Title", "Setup", "Usage"]);
    expect(chunks.find((c) => c.name === "Setup")?.text).toContain("Run it.");
  });

  it("keeps what came before the first heading", () => {
    expect(chunkFile("README.md", MD)[0].text).toContain("Intro paragraph.");
  });
});

describe("when there is no structure to find", () => {
  it("falls back to overlapping windows", () => {
    const lines = Array.from({ length: 150 }, (_, i) => `line ${i}`).join("\n");
    const chunks = chunkFile("data.txt", lines);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.kind === "window")).toBe(true);
    // Overlapping, so a fact spanning a boundary is whole in one of them.
    expect(chunks[1].startLine).toBeLessThan(chunks[0].endLine);
  });

  it("windows a declaration too long to hold in one piece", () => {
    const body = Array.from({ length: 300 }, (_, i) => `  const x${i} = ${i};`).join("\n");
    const chunks = chunkFile("big.ts", `export function huge() {\n${body}\n}\n`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.endLine - c.startLine < 120)).toBe(true);
  });

  it("returns nothing for an empty file rather than one empty chunk", () => {
    expect(chunkFile("empty.ts", "")).toEqual([]);
    expect(chunkFile("blank.ts", "\n\n\n")).toEqual([]);
  });
});

describe("small helpers", () => {
  it("reads the extension, including from a dotfile path", () => {
    expect(extensionOf("src/a/b.test.ts")).toBe("ts");
    expect(extensionOf("Makefile")).toBe("");
    expect(extensionOf(".gitignore")).toBe("");
  });

  it("estimates tokens as something, not zero", () => {
    expect(approxTokens("")).toBe(0);
    expect(approxTokens("a".repeat(400))).toBe(100);
  });
});
