import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { approxTokens, chunkFile, type Chunk } from "./chunk";

// The index: what the project contains, in pieces, on disk.
//
// SQLite because it is already here (bun:sqlite), it survives the process, and
// FTS5 brings BM25 with it. The ranking function matters more than it sounds:
// without a real one, "retrieval" is substring matching wearing a hat, and it
// returns the file that mentions a word most often rather than the file that
// is about it.
//
// Reindexing is keyed on content hash, per file. Opening a session in a large
// repository should not cost a full rebuild, and after an edit only the file
// that changed is re-chunked.

export interface IndexedChunk extends Chunk {
  id: number;
  tokens: number;
}

export interface ReindexResult {
  scanned: number;
  reindexed: number;
  removed: number;
  chunks: number;
}

/** Identifiers are where the meaning is, and FTS5's tokenizer keeps
 *  `parseRepo` as one word. Splitting camelCase and snake_case into their parts
 *  as well is what makes "parse repo" find it. */
export function expandTerms(text: string): string {
  const parts = new Set<string>();
  for (const raw of text.split(/[^A-Za-z0-9_$]+/)) {
    if (!raw) continue;
    parts.add(raw);
    for (const piece of raw.split(/[_$]+/)) {
      if (!piece) continue;
      parts.add(piece);
      for (const camel of piece.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)) {
        if (camel.length > 1) parts.add(camel.toLowerCase());
      }
    }
  }
  return [...parts].join(" ");
}

export function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export class MemoryStore {
  private readonly db: Database;

  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.run(`CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      indexed_at TEXT NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      text TEXT NOT NULL,
      tokens INTEGER NOT NULL
    )`);
    this.db.run("CREATE INDEX IF NOT EXISTS chunks_by_path ON chunks(path)");
    // Not external-content: the chunk rows are small and keeping the two in
    // step by hand is a bug waiting to happen.
    //
    // The porter tokenizer stems both sides, which is not a nicety. Without it
    // "where does it deploy" does not match a README that says "Deploys to
    // Netlify", because the default tokenizer treats those as different words
    // and questions are rarely phrased in the tense the source is written in.
    this.db.run(
      "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(terms, tokenize = 'porter unicode61')",
    );
    this.db.run(`CREATE TABLE IF NOT EXISTS vectors (
      chunk_id INTEGER PRIMARY KEY,
      model TEXT NOT NULL,
      vector BLOB NOT NULL
    )`);
    this.db.run(`CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note TEXT NOT NULL,
      tag TEXT,
      written_at TEXT NOT NULL
    )`);
  }

  close() {
    this.db.close();
  }

  get chunkCount(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
  }

  get fileCount(): number {
    return (this.db.query("SELECT COUNT(*) AS n FROM files").get() as { n: number }).n;
  }

  hashFor(path: string): string | null {
    const row = this.db.query("SELECT hash FROM files WHERE path = ?").get(path) as
      | { hash: string }
      | undefined;
    return row?.hash ?? null;
  }

  /** Replace everything indexed for one file. Called only when the hash moved,
   *  so an unchanged file costs one lookup. */
  private replaceFile(path: string, content: string) {
    this.removeFile(path);
    const chunks = chunkFile(path, content);
    const insertChunk = this.db.prepare(
      "INSERT INTO chunks (path, start_line, end_line, kind, name, text, tokens) VALUES (?, ?, ?, ?, ?, ?, ?)",
    );
    const insertTerms = this.db.prepare("INSERT INTO chunks_fts (rowid, terms) VALUES (?, ?)");

    for (const chunk of chunks) {
      const result = insertChunk.run(
        chunk.path,
        chunk.startLine,
        chunk.endLine,
        chunk.kind,
        chunk.name,
        chunk.text,
        approxTokens(chunk.text),
      );
      // The path and the name are repeated so a query that names either ranks
      // the chunk above one that merely mentions the word in passing.
      const terms = [
        expandTerms(path),
        expandTerms(path),
        chunk.name ? `${expandTerms(chunk.name)} ${expandTerms(chunk.name)}` : "",
        expandTerms(chunk.text),
      ].join(" ");
      insertTerms.run(Number(result.lastInsertRowid), terms);
    }

    this.db.run("INSERT OR REPLACE INTO files (path, hash, indexed_at) VALUES (?, ?, ?)", [
      path,
      hashOf(content),
      new Date().toISOString(),
    ]);
    return chunks.length;
  }

  removeFile(path: string) {
    const ids = this.db.query("SELECT id FROM chunks WHERE path = ?").all(path) as {
      id: number;
    }[];
    for (const { id } of ids) {
      this.db.run("DELETE FROM chunks_fts WHERE rowid = ?", [id]);
      this.db.run("DELETE FROM vectors WHERE chunk_id = ?", [id]);
    }
    this.db.run("DELETE FROM chunks WHERE path = ?", [path]);
    this.db.run("DELETE FROM files WHERE path = ?", [path]);
  }

  /**
   * Bring the index in line with a set of files.
   *
   * Unchanged files are skipped on a hash comparison, changed ones re-chunked,
   * and files that are no longer present removed. That last part is the one
   * that is easy to leave out and produces an index that confidently returns
   * code which was deleted last week.
   */
  reindex(files: Record<string, string>): ReindexResult {
    const result: ReindexResult = { scanned: 0, reindexed: 0, removed: 0, chunks: 0 };

    this.db.run("BEGIN");
    try {
      const known = new Set(
        (this.db.query("SELECT path FROM files").all() as { path: string }[]).map((r) => r.path),
      );

      for (const [path, content] of Object.entries(files)) {
        result.scanned++;
        known.delete(path);
        if (this.hashFor(path) === hashOf(content)) continue;
        result.chunks += this.replaceFile(path, content);
        result.reindexed++;
      }

      for (const gone of known) {
        this.removeFile(gone);
        result.removed++;
      }
      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }
    return result;
  }

  /** BM25 over the expanded terms. Lower is better in SQLite, so it is negated
   *  here and every score in this module means "higher is more relevant". */
  search(query: string, limit = 40): Array<IndexedChunk & { score: number }> {
    const words = expandTerms(query)
      .split(/\s+/)
      .filter((t) => t.length > 1)
      .map((t) => t.replace(/"/g, ""))
      .filter(Boolean);
    if (words.length === 0) return [];

    // Quoted so a term that happens to be FTS5 syntax (AND, NEAR, a bare
    // asterisk) is matched as a word instead of throwing a syntax error.
    //
    // Longer terms also match as a prefix, because identifiers are routinely
    // the query word with something stuck on the end: searching "nonce" should
    // find `nonce0` and `nonceStore`, which neither exact matching nor
    // stemming will do. Four characters is the floor, so "id" does not match
    // half the codebase.
    const terms = words.flatMap((word) =>
      word.length >= 4 ? [`"${word}"`, `"${word}"*`] : [`"${word}"`],
    );

    const rows = this.db
      .query(
        `SELECT c.*, bm25(chunks_fts) AS rank
         FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
         WHERE chunks_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(terms.join(" OR "), limit) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      ...toChunk(row),
      score: -(row.rank as number),
    }));
  }

  allChunks(): IndexedChunk[] {
    return (this.db.query("SELECT * FROM chunks").all() as Array<Record<string, unknown>>).map(
      toChunk,
    );
  }

  chunkById(id: number): IndexedChunk | null {
    const row = this.db.query("SELECT * FROM chunks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? toChunk(row) : null;
  }

  // --- vectors -------------------------------------------------------------

  putVector(chunkId: number, model: string, vector: Float32Array) {
    this.db.run("INSERT OR REPLACE INTO vectors (chunk_id, model, vector) VALUES (?, ?, ?)", [
      chunkId,
      model,
      Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
    ]);
  }

  vectors(model: string): Array<{ chunkId: number; vector: Float32Array }> {
    const rows = this.db
      .query("SELECT chunk_id, vector FROM vectors WHERE model = ?")
      .all(model) as Array<{ chunk_id: number; vector: Uint8Array }>;
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      vector: new Float32Array(
        row.vector.buffer.slice(
          row.vector.byteOffset,
          row.vector.byteOffset + row.vector.byteLength,
        ),
      ),
    }));
  }

  /** Chunks with no vector for this model yet, so embedding can be resumed
   *  rather than redone after an interrupted run or a new key. */
  chunksWithoutVectors(model: string, limit = 500): IndexedChunk[] {
    const rows = this.db
      .query(
        `SELECT c.* FROM chunks c
         LEFT JOIN vectors v ON v.chunk_id = c.id AND v.model = ?
         WHERE v.chunk_id IS NULL
         LIMIT ?`,
      )
      .all(model, limit) as Array<Record<string, unknown>>;
    return rows.map(toChunk);
  }

  // --- notes ---------------------------------------------------------------

  addNote(note: string, tag: string | null): number {
    const result = this.db.run("INSERT INTO notes (note, tag, written_at) VALUES (?, ?, ?)", [
      note,
      tag,
      new Date().toISOString(),
    ]);
    return Number(result.lastInsertRowid);
  }

  notes(limit = 50): Array<{ id: number; note: string; tag: string | null; writtenAt: string }> {
    return (
      this.db.query("SELECT * FROM notes ORDER BY id DESC LIMIT ?").all(limit) as Array<{
        id: number;
        note: string;
        tag: string | null;
        written_at: string;
      }>
    ).map((row) => ({ id: row.id, note: row.note, tag: row.tag, writtenAt: row.written_at }));
  }
}

function toChunk(row: Record<string, unknown>): IndexedChunk {
  return {
    id: row.id as number,
    path: row.path as string,
    startLine: row.start_line as number,
    endLine: row.end_line as number,
    kind: row.kind as IndexedChunk["kind"],
    name: (row.name as string | null) ?? null,
    text: row.text as string,
    tokens: row.tokens as number,
  };
}
