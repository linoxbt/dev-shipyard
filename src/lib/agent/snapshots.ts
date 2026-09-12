import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Workspace } from "./workspace";

// Undo for a workspace that is not a git repository.
//
// Checkpointing through git is the better mechanism and stays the default: a
// checkpoint you can read with `git log` and recover by hand is one a person
// can trust. But it only exists where git does, and the agent is meant to be
// exactly as capable pointed at an empty folder as at a mature project. Until
// now the honest consequence of that was `doctor` reporting "no, so there are
// no checkpoints and no undo": truthful, and still a capability that silently
// depended on someone else's choice of version control.
//
// So this is the second path. Same shape as the git one, deliberately: take a
// checkpoint after a turn that changed something, list them, and rewind the
// most recent. It copies files rather than diffing them, which is the right
// trade at this size -- a workspace the agent can read is small, and a copy
// nobody has to decode is the thing you want when the clever mechanism is what
// went wrong.

const DIR = ".devstation/checkpoints";
/** Enough to undo a session's worth of work, bounded so a long session does
 *  not quietly fill a disk with copies of a project. */
const KEEP = 20;

export interface Snapshot {
  id: string;
  at: string;
  message: string;
  /** Paths captured, relative to the workspace root. */
  files: string[];
}

function storeDir(root: string): string {
  return join(root, DIR);
}

/** Snapshots, newest first. */
export function listSnapshots(root: string): Snapshot[] {
  const dir = storeDir(root);
  if (!existsSync(dir)) return [];
  const found: Snapshot[] = [];
  for (const entry of readdirSync(dir)) {
    const manifest = join(dir, entry, "manifest.json");
    if (!existsSync(manifest)) continue;
    try {
      found.push(JSON.parse(readFileSync(manifest, "utf8")) as Snapshot);
    } catch {
      // A half-written manifest is not a reason to lose the others.
    }
  }
  return found.sort((a, b) => b.id.localeCompare(a.id));
}

/**
 * Copy the current state of the workspace aside.
 *
 * Uses the workspace's own reader, so it captures exactly what the agent can
 * see and skips what it skips: node_modules, dist, .git and the rest. Without
 * that, a checkpoint of a project with dependencies installed would copy tens
 * of thousands of files nobody wants back.
 */
export function takeSnapshot(root: string, message: string): Snapshot | null {
  const workspace = new Workspace(root);
  const files = workspace
    .list(".")
    .filter((p) => !p.startsWith(`${DIR}/`) && !p.startsWith(".devstation/"));
  if (files.length === 0) return null;

  // Sortable and unique: listing and rewinding both depend on the order.
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const dir = join(storeDir(root), id);
  mkdirSync(join(dir, "files"), { recursive: true });

  const captured: string[] = [];
  for (const path of files) {
    const from = join(root, path);
    if (!existsSync(from)) continue;
    const to = join(dir, "files", path);
    mkdirSync(dirname(to), { recursive: true });
    try {
      cpSync(from, to);
      captured.push(path);
    } catch {
      // An unreadable file is not a reason to abandon the checkpoint; it is
      // recorded as absent, which is what restoring it will then do.
    }
  }

  const snapshot: Snapshot = {
    id,
    at: new Date().toISOString(),
    message,
    files: captured,
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}\n`);
  prune(root);
  return snapshot;
}

/** Keep the newest KEEP, so a long session does not fill a disk. */
function prune(root: string) {
  const all = listSnapshots(root);
  for (const old of all.slice(KEEP)) {
    rmSync(join(storeDir(root), old.id), { recursive: true, force: true });
  }
}

/**
 * Put the workspace back to the most recent snapshot.
 *
 * Restores every captured file and deletes anything created since, which is
 * what makes this an undo rather than a merge: a turn that added three files
 * and changed one is not undone by restoring the one.
 *
 * The snapshot is consumed. Undo twice goes back two turns, matching what
 * `git reset --hard HEAD~1` does on the other path.
 */
export function undoSnapshot(root: string): { ok: boolean; message: string } {
  const [latest] = listSnapshots(root);
  if (!latest) {
    return { ok: false, message: "There is no checkpoint to undo." };
  }

  const workspace = new Workspace(root);
  const dir = join(storeDir(root), latest.id);
  const kept = new Set(latest.files);

  // Anything the agent can see that was not in the snapshot arrived after it.
  for (const path of workspace.list(".")) {
    if (kept.has(path) || path.startsWith(".devstation/")) continue;
    rmSync(join(root, path), { force: true });
  }

  for (const path of latest.files) {
    const from = join(dir, "files", path);
    if (!existsSync(from)) continue;
    const to = join(root, path);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }

  rmSync(dir, { recursive: true, force: true });
  return { ok: true, message: `Undid ${latest.message}` };
}

/** Throw away one snapshot, for a turn that turned out to change nothing. */
export function discardSnapshot(root: string, id: string): void {
  rmSync(join(storeDir(root), id), { recursive: true, force: true });
}

/** True when this workspace has snapshot checkpoints to offer. */
export function hasSnapshots(root: string): boolean {
  return listSnapshots(root).length > 0;
}
