import { afterEach, describe, expect, it } from "bun:test";
import { cosine, embeddingsFromEnv, embedMissing, type EmbeddingProvider } from "./embeddings";
import { renderContext, retrieve, weightFor, withinBudget } from "./retrieve";
import { MemoryStore } from "./store";
import { approxTokens } from "./chunk";

const stores: MemoryStore[] = [];
function store(files: Record<string, string>): MemoryStore {
  const s = new MemoryStore(":memory:");
  stores.push(s);
  s.reindex(files);
  return s;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
});

const PROJECT = {
  "src/replay.ts": `/** Refuses a request whose nonce has been seen before. */
export function guardReplay(nonce) {
  if (seen.has(nonce)) throw new Error("already used");
  seen.add(nonce);
}
`,
  "src/total.ts": `export function total(items) {
  return items.reduce((sum, i) => sum + i.price, 0);
}
`,
  "docs/deploy.md": `# Deployment

The site builds on Netlify when main is pushed.
`,
};

/** An embedding provider with no network: vectors are assigned per phrase, so
 *  a test can say "these two mean the same thing" and have it be true. */
function fakeEmbeddings(meanings: Record<string, number[]>): EmbeddingProvider & {
  calls: string[][];
} {
  const calls: string[][] = [];
  return {
    name: "fake",
    model: "fake-model",
    calls,
    async embed(texts: string[]) {
      calls.push(texts);
      return texts.map((text) => {
        const key = Object.keys(meanings).find((k) => text.includes(k));
        return Float32Array.from(key ? meanings[key] : [0, 0, 1]);
      });
    },
  };
}

describe("retrieving without any embedding key", () => {
  it("answers from the lexical index alone", async () => {
    const hits = await retrieve(store(PROJECT), "how are replayed nonces rejected");
    expect(hits[0].path).toBe("src/replay.ts");
    expect(hits[0].from).toEqual(["lexical"]);
  });

  it("labels results with where they came from", async () => {
    const hits = await retrieve(store(PROJECT), "deployment");
    expect(renderContext(hits)).toContain("docs/deploy.md:1-");
  });

  it("returns nothing, and says nothing, when there is no index", async () => {
    expect(await retrieve(store({}), "anything")).toEqual([]);
    expect(renderContext([])).toBe("");
  });
});

describe("the token budget", () => {
  it("is a ceiling, not a suggestion", () => {
    const chunks = [
      { tokens: 100, id: 1 },
      { tokens: 100, id: 2 },
      { tokens: 100, id: 3 },
    ];
    expect(withinBudget(chunks, 250).map((c) => c.id)).toEqual([1, 2]);
  });

  it("stops rather than skipping to something smaller further down", () => {
    // Order is relevance. Filling the last of the budget with the worst result
    // would make the ranking a lie.
    const chunks = [
      { tokens: 100, id: 1 },
      { tokens: 900, id: 2 },
      { tokens: 10, id: 3 },
    ];
    expect(withinBudget(chunks, 200).map((c) => c.id)).toEqual([1]);
  });

  it("still returns the best chunk when it alone exceeds the budget", () => {
    // Otherwise this reads to the agent as "the project contains nothing
    // about this", which is a different and wrong answer.
    expect(withinBudget([{ tokens: 9000, id: 1 }], 100)).toHaveLength(1);
  });

  it("holds when retrieving for real", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      many[`src/f${i}.ts`] = `export function nonce${i}() {\n  return "${"x".repeat(400)}";\n}\n`;
    }
    const hits = await retrieve(store(many), "nonce", { maxTokens: 300 });
    expect(hits.reduce((sum, h) => sum + h.tokens, 0)).toBeLessThanOrEqual(300);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("retrieving with embeddings", () => {
  it("finds what shares no words with the question", async () => {
    // The case BM25 cannot reach: the question and the code have no vocabulary
    // in common.
    const s = store(PROJECT);
    const provider = fakeEmbeddings({
      guardReplay: [1, 0, 0],
      "prevent duplicate submissions": [1, 0, 0],
    });
    await embedMissing(s, provider);

    const lexicalOnly = await retrieve(s, "prevent duplicate submissions");
    expect(lexicalOnly.some((h) => h.path === "src/replay.ts")).toBe(false);

    const hybrid = await retrieve(s, "prevent duplicate submissions", {
      embeddings: provider,
    });
    expect(hybrid[0].path).toBe("src/replay.ts");
    expect(hybrid[0].from).toContain("vector");
  });

  it("keeps working when the embedding service is down", async () => {
    const s = store(PROJECT);
    await embedMissing(s, fakeEmbeddings({ guardReplay: [1, 0, 0] }));
    const broken: EmbeddingProvider = {
      name: "broken",
      model: "fake-model",
      embed: () => Promise.reject(new Error("network is gone")),
    };

    const hits = await retrieve(s, "replayed nonces", { embeddings: broken });
    expect(hits[0].path).toBe("src/replay.ts");
    expect(hits[0].from).toEqual(["lexical"]);
  });

  it("does not pay for a query vector when nothing is embedded yet", async () => {
    const s = store(PROJECT);
    const provider = fakeEmbeddings({});
    await retrieve(s, "anything", { embeddings: provider });
    expect(provider.calls).toHaveLength(0);
  });
});

describe("embedding the index", () => {
  it("stores as it goes, so an interrupted run leaves progress", async () => {
    const s = store(PROJECT);
    const total = s.chunkCount;
    let batches = 0;
    const failing: EmbeddingProvider = {
      name: "flaky",
      model: "fake-model",
      async embed(texts) {
        if (batches++ === 1) throw new Error("rate limited");
        return texts.map(() => Float32Array.from([1, 0, 0]));
      },
    };

    await expect(embedMissing(s, failing, { batchSize: 1 })).rejects.toThrow("rate limited");
    expect(s.vectors("fake-model")).toHaveLength(1);
    expect(s.chunksWithoutVectors("fake-model")).toHaveLength(total - 1);
  });

  it("picks up where it stopped rather than paying again", async () => {
    const s = store(PROJECT);
    const provider = fakeEmbeddings({});
    await embedMissing(s, provider, { batchSize: 2 });
    const first = provider.calls.flat().length;

    await embedMissing(s, provider, { batchSize: 2 });
    expect(provider.calls.flat().length).toBe(first);
  });

  it("does not attach a vector to the wrong chunk when a batch comes back short", async () => {
    const s = store(PROJECT);
    const short: EmbeddingProvider = {
      name: "short",
      model: "fake-model",
      // Returns one fewer vector than it was given.
      async embed(texts) {
        return texts.slice(1).map(() => Float32Array.from([1, 0, 0]));
      },
    };
    await embedMissing(s, short, { batchSize: 4 });
    for (const { chunkId } of s.vectors("fake-model")) {
      expect(s.chunkById(chunkId)).not.toBeNull();
    }
  });
});

describe("cosine", () => {
  it("is 1 for the same direction and 0 for orthogonal", () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([2, 0]))).toBeCloseTo(1);
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0);
  });

  it("does not throw on mismatched or empty vectors", () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([1, 0, 0]))).toBe(0);
    expect(cosine(Float32Array.from([]), Float32Array.from([]))).toBe(0);
    expect(cosine(Float32Array.from([0, 0]), Float32Array.from([0, 0]))).toBe(0);
  });
});

describe("choosing a provider", () => {
  it("is null when no key is set, which is an ordinary outcome", () => {
    expect(embeddingsFromEnv({})).toBeNull();
  });

  it("prefers the code model when Voyage is configured", () => {
    expect(embeddingsFromEnv({ VOYAGE_API_KEY: "k" })?.model).toBe("voyage-code-3");
    expect(embeddingsFromEnv({ OPENAI_API_KEY: "k" })?.name).toBe("openai");
  });
});

describe("what the budget actually covers", () => {
  it("counts the headers and preamble, not only the chunk text", async () => {
    // A budget that measures only the text understates what is sent by however
    // many chunks happen to fit.
    const files: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      files[`src/nonce/store${i}.ts`] =
        `export function nonceStore${i}() {\n  return "${"x".repeat(200)}";\n}\n`;
    }
    const s = store(files);
    for (const budget of [200, 600, 1500]) {
      const hits = await retrieve(s, "nonce store", { maxTokens: budget });
      expect(approxTokens(renderContext(hits))).toBeLessThanOrEqual(budget);
    }
  });
});

describe("tests against the code they test", () => {
  it("puts the implementation above its test file", async () => {
    // Seen on this codebase: asked how the agent stops itself running forever,
    // the index returned three chunks of orchestrator.test.ts before the budget
    // check in orchestrator.ts. Tests repeat the vocabulary of what they test,
    // which is what BM25 rewards.
    const s = store({
      "src/budget.ts": `/** Stops a run that has gone past its step limit. */
export function budgetCheck(steps, limit) {
  return steps >= limit ? "stopped at the step limit" : null;
}
`,
      "src/budget.test.ts": `import { budgetCheck } from "./budget";
it("stops at the step limit", () => {
  expect(budgetCheck(5, 5)).toContain("step limit");
});
it("does not stop below the step limit", () => {
  expect(budgetCheck(4, 5)).toBeNull();
});
it("stops well past the step limit", () => {
  expect(budgetCheck(50, 5)).toContain("step limit");
});
`,
    });

    const hits = await retrieve(s, "how does it stop at the step limit");
    expect(hits[0].path).toBe("src/budget.ts");
  });

  it("still returns the test, because sometimes that is the answer", async () => {
    const s = store({
      "src/budget.ts": "export function budgetCheck() {}\n",
      "src/budget.test.ts": "it('stops at the step limit', () => {});\n",
    });
    const paths = (await retrieve(s, "step limit")).map((h) => h.path);
    expect(paths).toContain("src/budget.test.ts");
  });

  it("recognises the usual places tests live", () => {
    for (const path of ["a/b.test.ts", "a/b.spec.js", "tests/a.py", "__tests__/a.ts", "e2e/a.ts"]) {
      expect(weightFor(path)).toBeLessThan(1);
    }
    for (const path of ["src/latest.ts", "src/contest/a.ts", "spectrum.ts"]) {
      expect(weightFor(path)).toBe(1);
    }
  });
});
