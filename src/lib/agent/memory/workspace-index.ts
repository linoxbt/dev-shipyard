import { join } from "node:path";
import { readWorkspaceBounded, type ReadStop } from "../repo-session";
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

/** Folders that hold a person's everything rather than one project: home, and
 *  the Desktop, Documents and Downloads inside it. Indexing one puts private
 *  notes, keys and unrelated projects in front of the model. Compared without
 *  regard to slash direction or, on Windows, case, so C:\Users\Me\Desktop and
 *  /c/Users/Me/Desktop are the same folder. */
export function isPersonalFolder(
  root: string,
  home: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!home) return false;
  const norm = (p: string) => {
    let out = p.replace(/\\/g, "/").replace(/\/+$/, "");
    // Git Bash spells C:\ as /c/.
    out = out.replace(/^\/([a-zA-Z])\//, "$1:/");
    return platform === "win32" ? out.toLowerCase() : out;
  };
  const target = norm(root);
  const base = norm(home);
  const inside = ["Desktop", "Documents", "Downloads"].map((name) => norm(`${home}/${name}`));
  return target === base || inside.includes(target);
}

export function openStore(root: string): MemoryStore {
  return new MemoryStore(storePath(root));
}

export interface IndexResult extends ReindexResult {
  embedded: number;
  /** Null when no embedding key is configured, which is the ordinary case. */
  embeddingModel: string | null;
  /** Why not everything was indexed, or null when it was. */
  stopped: ReadStop | "home";
  ms: number;
}

export async function indexWorkspace(
  root: string,
  options: {
    store?: MemoryStore;
    embeddings?: EmbeddingProvider | null;
    /** Defaults to HOME. A workspace that IS the home directory is not
     *  indexed at all: everything under it is every repository and cache the
     *  person has, and indexing that is never what they meant. */
    home?: string;
    maxFiles?: number;
    deadlineMs?: number;
  } = {},
): Promise<IndexResult> {
  const started = Date.now();
  const home = options.home ?? process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (isPersonalFolder(root, home)) {
    return {
      scanned: 0,
      reindexed: 0,
      removed: 0,
      chunks: 0,
      embedded: 0,
      embeddingModel: null,
      stopped: "home",
      ms: 0,
    };
  }

  const store = options.store ?? openStore(root);
  const read = readWorkspaceBounded(root, {
    maxFiles: options.maxFiles,
    deadlineMs: options.deadlineMs,
  });
  const result = store.reindex(read.files, { partial: read.stopped !== null });

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

  return {
    ...result,
    embedded,
    embeddingModel: options.embeddings?.model ?? null,
    stopped: read.stopped,
    ms: Date.now() - started,
  };
}
