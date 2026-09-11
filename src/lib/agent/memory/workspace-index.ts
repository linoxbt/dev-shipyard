import { join } from "node:path";
import { readWorkspace } from "../repo-session";
import { embedMissing, type EmbeddingProvider } from "./embeddings";
import { MemoryStore, type ReindexResult } from "./store";

// Keeping the index in step with a workspace on disk.
//
// Deliberately the same file walk the pull request path uses, so what the
// index knows about and what would be committed cannot drift apart. The index
// lives inside .agent, which is already private to the workspace and ignored
// by git, so indexing a repository never shows up as a change to it.

export function storePath(root: string): string {
  return join(root, ".agent", "memory.db");
}

export function openStore(root: string): MemoryStore {
  return new MemoryStore(storePath(root));
}

export interface IndexResult extends ReindexResult {
  embedded: number;
  /** Null when no embedding key is configured, which is the ordinary case. */
  embeddingModel: string | null;
}

export async function indexWorkspace(
  root: string,
  options: { store?: MemoryStore; embeddings?: EmbeddingProvider | null } = {},
): Promise<IndexResult> {
  const store = options.store ?? openStore(root);
  const result = store.reindex(readWorkspace(root));

  let embedded = 0;
  if (options.embeddings) {
    try {
      embedded = await embedMissing(store, options.embeddings);
    } catch {
      // A rate limit or a dead key leaves whatever was embedded before it
      // stopped, and the lexical index works regardless. Failing the whole
      // index over the optional half of it would be the wrong trade.
      embedded = 0;
    }
  }

  return { ...result, embedded, embeddingModel: options.embeddings?.model ?? null };
}
