import { cosine, type EmbeddingProvider } from "./embeddings";
import type { IndexedChunk, MemoryStore } from "./store";

// Choosing what to put in front of the model.
//
// Two constraints shape this. The first is that retrieved context competes
// with the conversation: a generous budget spent on near-misses pushes out the
// thing the agent actually needs, so the cap is in tokens and is enforced, not
// advisory. The second is that the two rankers disagree in scale. BM25 scores
// and cosine similarities are not comparable numbers, and normalising them
// invents a relationship that is not there. Reciprocal rank fusion uses only
// the positions, which is what both rankers are actually good at.

export interface Retrieved extends IndexedChunk {
  score: number;
  /** Which rankers found it. Useful when a result looks wrong. */
  from: Array<"lexical" | "vector">;
}

export interface RetrieveOptions {
  /** The hard ceiling on retrieved context. */
  maxTokens?: number;
  /** How many candidates each ranker contributes before fusion. */
  candidates?: number;
  embeddings?: EmbeddingProvider | null;
  signal?: AbortSignal;
}

const DEFAULT_MAX_TOKENS = 6000;
const DEFAULT_CANDIDATES = 40;
/** The constant from the reciprocal rank fusion paper. It flattens the
 *  difference between the first and second result, which is what stops one
 *  ranker's confident mistake from dominating. */
const RRF_K = 60;

/** Tests repeat the vocabulary of what they test, over and over, which is
 *  exactly what BM25 rewards. Asked "how does the agent stop itself running
 *  forever", the index put three chunks of orchestrator.test.ts above the
 *  budget check in orchestrator.ts. A test is worth retrieving, and sometimes
 *  it is the best answer, so this is a thumb on the scale rather than a filter.
 */
const TEST_PATH = /(^|\/)(?:tests?|__tests__|spec|e2e)(\/|$)|\.(?:test|spec)\.[a-z]+$/i;
const TEST_WEIGHT = 0.5;

export function weightFor(path: string): number {
  return TEST_PATH.test(path) ? TEST_WEIGHT : 1;
}

export async function retrieve(
  store: MemoryStore,
  query: string,
  options: RetrieveOptions = {},
): Promise<Retrieved[]> {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES;
  const lexical = store.search(query, candidates);

  const ranked = new Map<number, { chunk: IndexedChunk; score: number; from: Set<string> }>();
  const add = (chunk: IndexedChunk, rank: number, source: string) => {
    const existing = ranked.get(chunk.id);
    const contribution = 1 / (RRF_K + rank + 1);
    if (existing) {
      existing.score += contribution;
      existing.from.add(source);
    } else {
      ranked.set(chunk.id, { chunk, score: contribution, from: new Set([source]) });
    }
  };

  lexical.forEach((chunk, index) => add(chunk, index, "lexical"));

  const vectorHits = await vectorSearch(store, query, candidates, options);
  vectorHits.forEach((chunk, index) => add(chunk, index, "vector"));

  const ordered = [...ranked.values()]
    .map((entry) => ({
      ...entry.chunk,
      score: entry.score * weightFor(entry.chunk.path),
      from: [...entry.from] as Array<"lexical" | "vector">,
    }))
    .sort((a, b) => b.score - a.score);

  const budget = (options.maxTokens ?? DEFAULT_MAX_TOKENS) - PREAMBLE_TOKENS;
  return withinBudget(ordered, budget, HEADER_TOKENS);
}

async function vectorSearch(
  store: MemoryStore,
  query: string,
  limit: number,
  options: RetrieveOptions,
): Promise<IndexedChunk[]> {
  const provider = options.embeddings;
  if (!provider) return [];

  const stored = store.vectors(provider.model);
  // No vectors for this model means embedding has not been run, or was run
  // with a different one. Lexical results stand on their own; this is not
  // worth an error or a paid round trip.
  if (stored.length === 0) return [];

  let queryVector: Float32Array;
  try {
    [queryVector] = await provider.embed([query], options.signal);
  } catch {
    // A retrieval that cannot reach the embedding service should degrade to
    // the lexical half, not fail the agent's turn.
    return [];
  }
  if (!queryVector) return [];

  return stored
    .map((entry) => ({ chunkId: entry.chunkId, score: cosine(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => store.chunkById(entry.chunkId))
    .filter((chunk): chunk is IndexedChunk => chunk !== null);
}

/** What `renderContext` adds on top of the chunk text itself: a preamble and a
 *  closing line once, and a `--- path:from-to (name) ---` header per chunk.
 *  Counted, because a budget that covers only the text understates what is
 *  actually sent by however many chunks happen to fit. */
export const PREAMBLE_TOKENS = 40;
const HEADER_TOKENS = 20;

/** Take chunks in order until the budget runs out.
 *
 *  Stops rather than skipping ahead to something smaller: order is relevance,
 *  and filling the last few hundred tokens with the twentieth-best result is
 *  not worth making the ranking a lie. */
export function withinBudget<T extends { tokens: number }>(
  chunks: T[],
  maxTokens: number,
  overhead = 0,
): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const chunk of chunks) {
    if (used + chunk.tokens + overhead > maxTokens) break;
    kept.push(chunk);
    used += chunk.tokens + overhead;
  }
  // A single chunk larger than the whole budget would otherwise return nothing
  // at all, which reads as "the project contains nothing about this".
  if (kept.length === 0 && chunks.length > 0) kept.push(chunks[0]);
  return kept;
}

/** The retrieved context, written so the model can cite it.
 *
 *  Every chunk is labelled with its file and line range, because an agent that
 *  cannot say where something came from tends to describe it from memory. */
export function renderContext(chunks: Retrieved[]): string {
  if (chunks.length === 0) return "";
  const parts = chunks.map(
    (chunk) =>
      `--- ${chunk.path}:${chunk.startLine}-${chunk.endLine}` +
      `${chunk.name ? ` (${chunk.name})` : ""} ---\n${chunk.text}`,
  );
  return [
    "Relevant parts of this project, found by searching it:",
    "",
    ...parts,
    "",
    "These are excerpts, not the whole project. Read a file properly before editing it.",
  ].join("\n");
}
