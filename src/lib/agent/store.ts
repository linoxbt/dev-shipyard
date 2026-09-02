import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Where the security stores keep their records between restarts.
//
// Grants and decisions used to live in module-level Maps while jobs were
// persisted atomically to disk. That mismatch was the bug: restart the runner
// while a task was waiting on an answer and the job came back still waiting,
// with no grant and no request left to answer it. Hung forever, and with no
// error to show for it, because nothing had failed — the question had simply
// stopped existing.
//
// The interface is deliberately dumb: whole-document read and write of an
// opaque string. The stores are small (a handful of records per task, expiring
// in minutes) and the runner is one process, so there is nothing here worth the
// complexity of a real database. When Phase 7 has a reason to move, this is the
// seam it moves behind.

export interface PersistentStore {
  /** The last saved document, or null when nothing has been saved yet. */
  load(): string | null;
  save(document: string): void;
}

/**
 * A store backed by one file.
 *
 * Writes go to a sibling and are renamed into place. A rename is atomic, so a
 * crash midway through cannot leave a half-written file that fails to parse on
 * the way back up — the same reason the job store does it, and the failure mode
 * matters more here: an unparseable grant file means every grant is gone.
 */
export function fileStore(path: string): PersistentStore {
  return {
    load(): string | null {
      try {
        return readFileSync(path, "utf8");
      } catch {
        // Missing is the normal first-run case and is not an error. Unreadable
        // is treated the same way: an empty store denies everything, which is
        // the safe direction to fail.
        return null;
      }
    },
    save(document: string): void {
      try {
        mkdirSync(dirname(path), { recursive: true });
        const tmp = `${path}.tmp`;
        writeFileSync(tmp, document, "utf8");
        renameSync(tmp, path);
      } catch {
        // Disk trouble must not take the running task down. The consequence is
        // that this record does not survive a restart, which is the situation
        // we were already in before any of this existed.
      }
    },
  };
}

/** A store that keeps the document in memory. For tests, and for a runner
 *  configured without a state directory. */
export function memoryStore(): PersistentStore {
  let doc: string | null = null;
  return {
    load: () => doc,
    save: (document) => {
      doc = document;
    },
  };
}
