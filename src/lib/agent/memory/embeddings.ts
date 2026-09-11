// Embeddings, when there is a key for them.
//
// Retrieval here works without one: BM25 over expanded identifiers answers
// most questions about a codebase, because code is full of the exact words
// people use to ask about it. Embeddings add the case BM25 cannot reach, where
// the question and the code share no vocabulary at all ("how do we stop people
// double-spending" against a function called `guardReplay`).
//
// So this is an upgrade path, not a dependency. Nothing here is required for
// the index to work, and `embeddingsFromEnv` returning null is an ordinary
// outcome that callers handle rather than an error.

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  /** Vectors in the same order as the input. */
  embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]>;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  return denominator === 0 ? 0 : dot / denominator;
}

async function postJson(
  url: string,
  key: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Embedding request failed (${res.status}). ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Voyage, whose code model is the one worth having for this job. */
export class VoyageEmbeddings implements EmbeddingProvider {
  readonly name = "voyage";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = "voyage-code-3",
  ) {
    this.model = model;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const json = (await postJson(
      "https://api.voyageai.com/v1/embeddings",
      this.apiKey,
      { input: texts, model: this.model, input_type: "document" },
      signal,
    )) as { data: Array<{ embedding: number[]; index: number }> };

    // Returned order is not guaranteed, and a silently shuffled batch would
    // attach every vector to the wrong chunk.
    const out = new Array<Float32Array>(texts.length);
    for (const item of json.data) out[item.index] = Float32Array.from(item.embedding);
    return out;
  }
}

export class OpenAIEmbeddings implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;

  constructor(
    private readonly apiKey: string,
    model = "text-embedding-3-small",
  ) {
    this.model = model;
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const json = (await postJson(
      "https://api.openai.com/v1/embeddings",
      this.apiKey,
      { input: texts, model: this.model },
      signal,
    )) as { data: Array<{ embedding: number[]; index: number }> };

    const out = new Array<Float32Array>(texts.length);
    for (const item of json.data) out[item.index] = Float32Array.from(item.embedding);
    return out;
  }
}

/** Null when no key is set, which is the normal case and not a failure. */
export function embeddingsFromEnv(env: NodeJS.ProcessEnv = process.env): EmbeddingProvider | null {
  if (env.VOYAGE_API_KEY) return new VoyageEmbeddings(env.VOYAGE_API_KEY, env.VOYAGE_MODEL);
  if (env.OPENAI_API_KEY) return new OpenAIEmbeddings(env.OPENAI_API_KEY, env.OPENAI_EMBED_MODEL);
  return null;
}

export interface EmbedProgress {
  done: number;
  total: number;
}

/**
 * Embed in batches, storing as it goes.
 *
 * Stored per batch rather than at the end so an interrupted run, or a rate
 * limit part way through a large repository, leaves real progress behind. The
 * store knows which chunks still lack a vector, so the next attempt picks up
 * where this one stopped instead of paying for all of it again.
 */
export async function embedMissing(
  store: {
    chunksWithoutVectors(model: string, limit?: number): Array<{ id: number; text: string }>;
    putVector(chunkId: number, model: string, vector: Float32Array): void;
  },
  provider: EmbeddingProvider,
  options: { batchSize?: number; max?: number; onProgress?: (p: EmbedProgress) => void } = {},
): Promise<number> {
  const batchSize = options.batchSize ?? 64;
  const pending = store.chunksWithoutVectors(provider.model, options.max ?? 2000);
  let done = 0;

  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const vectors = await provider.embed(batch.map((c) => c.text));
    for (let j = 0; j < batch.length; j++) {
      const vector = vectors[j];
      // A provider that returned fewer vectors than inputs must not cause a
      // chunk to be stored against somebody else's vector.
      if (!vector) continue;
      store.putVector(batch[j].id, provider.model, vector);
      done++;
    }
    options.onProgress?.({ done, total: pending.length });
  }
  return done;
}
