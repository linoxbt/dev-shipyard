import { afterEach, describe, expect, it } from "bun:test";
import { expandTerms, hashOf, MemoryStore } from "./store";

const stores: MemoryStore[] = [];
function store(): MemoryStore {
  const s = new MemoryStore(":memory:");
  stores.push(s);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

const FILES = {
  "src/total.ts": `/** Adds up prices, applying quantity. */
export function total(items) {
  return items.reduce((sum, i) => sum + i.price * (i.quantity ?? 1), 0);
}
`,
  "src/auth/session.ts": `/** Seals a session token into a cookie the page cannot read. */
export function sealSession(token) {
  return encrypt(token);
}
`,
  "README.md": `# Demo

## Deployment

Deploys to Netlify on a push to main.
`,
};

describe("splitting identifiers", () => {
  it("makes the parts of a camelCase name searchable", () => {
    const terms = expandTerms("sealSession");
    expect(terms).toContain("sealSession");
    expect(terms).toContain("seal");
    expect(terms).toContain("session");
  });

  it("does the same for snake_case", () => {
    const terms = expandTerms("start_line_number");
    expect(terms).toContain("start");
    expect(terms).toContain("line");
    expect(terms).toContain("number");
  });

  it("keeps an acronym boundary sensible", () => {
    expect(expandTerms("parseHTTPResponse")).toContain("http");
    expect(expandTerms("parseHTTPResponse")).toContain("response");
  });
});

describe("indexing", () => {
  it("indexes files into chunks", () => {
    const s = store();
    const result = s.reindex(FILES);
    expect(result.scanned).toBe(3);
    expect(result.reindexed).toBe(3);
    expect(result.chunks).toBeGreaterThan(2);
    expect(s.fileCount).toBe(3);
    expect(s.chunkCount).toBe(result.chunks);
  });

  it("skips a file whose content has not moved", () => {
    const s = store();
    s.reindex(FILES);
    const again = s.reindex(FILES);
    expect(again.scanned).toBe(3);
    expect(again.reindexed).toBe(0);
    expect(again.chunks).toBe(0);
    expect(s.chunkCount).toBeGreaterThan(0);
  });

  it("re-chunks only the file that changed", () => {
    const s = store();
    s.reindex(FILES);
    const changed = { ...FILES, "src/total.ts": "export function total() { return 0; }\n" };
    const result = s.reindex(changed);
    expect(result.reindexed).toBe(1);
    expect(s.search("quantity").every((c) => !c.text.includes("i.quantity"))).toBe(true);
  });

  it("forgets a file that is no longer there", () => {
    // The easy thing to leave out, and it produces an index that confidently
    // returns code deleted last week.
    const s = store();
    s.reindex(FILES);
    expect(s.search("sealSession").length).toBeGreaterThan(0);

    const without = { ...FILES };
    delete (without as Record<string, string>)["src/auth/session.ts"];
    const result = s.reindex(without);

    expect(result.removed).toBe(1);
    expect(s.search("sealSession")).toEqual([]);
    expect(s.fileCount).toBe(2);
  });

  it("leaves no orphan rows behind when a file goes", () => {
    const s = store();
    s.reindex(FILES);
    const before = s.chunkCount;
    s.removeFile("src/total.ts");
    expect(s.chunkCount).toBeLessThan(before);
    // The text index went with it, not just the chunk rows.
    expect(s.search("applying quantity")).toEqual([]);
  });

  it("hashes content, so identical text reindexes to the same key", () => {
    expect(hashOf("abc")).toBe(hashOf("abc"));
    expect(hashOf("abc")).not.toBe(hashOf("abd"));
  });
});

describe("searching", () => {
  it("finds a function by a word from its doc comment", () => {
    const s = store();
    s.reindex(FILES);
    const hits = s.search("applying quantity to the price");
    expect(hits[0].path).toBe("src/total.ts");
  });

  it("finds a function by the parts of its name", () => {
    const s = store();
    s.reindex(FILES);
    // Never written as two words anywhere in the file.
    const hits = s.search("seal session");
    expect(hits[0].path).toBe("src/auth/session.ts");
  });

  it("finds a prose answer in the readme", () => {
    const s = store();
    s.reindex(FILES);
    const hits = s.search("where does it deploy");
    expect(hits[0].path).toBe("README.md");
    expect(hits[0].text).toContain("Netlify");
  });

  it("ranks, rather than merely matching", () => {
    const s = store();
    s.reindex(FILES);
    const hits = s.search("quantity");
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
  });

  it("returns line numbers that can be quoted back", () => {
    const s = store();
    s.reindex(FILES);
    const hit = s.search("seal session")[0];
    expect(hit.startLine).toBeGreaterThan(0);
    expect(hit.endLine).toBeGreaterThanOrEqual(hit.startLine);
  });

  it("does not throw on a query full of search syntax", () => {
    // A goal is written by a person, not escaped by one. "NEAR", "AND" and a
    // bare asterisk are all FTS5 operators.
    const s = store();
    s.reindex(FILES);
    for (const query of ['total AND "quantity', "NEAR * OR", "()", '"""']) {
      expect(() => s.search(query)).not.toThrow();
    }
  });

  it("returns nothing for a query with nothing in it", () => {
    const s = store();
    s.reindex(FILES);
    expect(s.search("")).toEqual([]);
    expect(s.search("   ")).toEqual([]);
  });
});

describe("vectors", () => {
  it("stores and reads back a vector unchanged", () => {
    const s = store();
    s.reindex(FILES);
    const chunk = s.allChunks()[0];
    const vector = new Float32Array([0.5, -0.25, 0.125]);
    s.putVector(chunk.id, "test-model", vector);

    const back = s.vectors("test-model");
    expect(back).toHaveLength(1);
    expect(back[0].chunkId).toBe(chunk.id);
    expect(Array.from(back[0].vector)).toEqual([0.5, -0.25, 0.125]);
  });

  it("knows which chunks still need embedding, so a run can be resumed", () => {
    const s = store();
    s.reindex(FILES);
    const all = s.allChunks();
    expect(s.chunksWithoutVectors("m")).toHaveLength(all.length);

    s.putVector(all[0].id, "m", new Float32Array([1]));
    expect(s.chunksWithoutVectors("m")).toHaveLength(all.length - 1);
    // A different model has its own coverage.
    expect(s.chunksWithoutVectors("other")).toHaveLength(all.length);
  });

  it("drops a chunk's vector when its file is reindexed", () => {
    const s = store();
    s.reindex(FILES);
    for (const chunk of s.allChunks()) s.putVector(chunk.id, "m", new Float32Array([1]));
    expect(s.vectors("m").length).toBe(s.chunkCount);

    s.reindex({ ...FILES, "src/total.ts": "export function total() { return 0; }\n" });
    // Every vector still points at a chunk that exists.
    for (const { chunkId } of s.vectors("m")) expect(s.chunkById(chunkId)).not.toBeNull();
  });
});

describe("notes", () => {
  it("keeps what it was told, newest first", () => {
    const s = store();
    s.addNote("The runner is self-hosted on port 8792.", "infrastructure");
    s.addNote("Pushes go to app-builder, never main.", "process");

    const notes = s.notes();
    expect(notes[0].note).toContain("app-builder");
    expect(notes[0].tag).toBe("process");
    expect(notes).toHaveLength(2);
  });
});

describe("partial identifiers", () => {
  it("finds a name the query is only the start of", () => {
    // Identifiers are routinely the query word with something on the end.
    // Neither exact matching nor stemming finds `nonceStore` from "nonce".
    const s = store();
    s.reindex({ "src/a.ts": "export function nonceStore() { return 1; }\n" });
    expect(s.search("nonce")[0]?.path).toBe("src/a.ts");
  });

  it("does not let a two-letter query match everything", () => {
    const s = store();
    s.reindex({
      "src/a.ts": "export const identifier = 1;\n",
      "src/b.ts": "export const x = 2;\n",
    });
    // "id" as a prefix would match `identifier`; as an exact term it does not.
    expect(s.search("id")).toEqual([]);
  });
});
