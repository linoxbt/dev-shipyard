// Applying a unified diff to a file.
//
// Whole-file rewrites are what this replaces. They cost a full file of output
// tokens per edit, and they lose anything the model forgot to re-emit, which
// is how "it deleted my imports" happens. A patch says only what changed.
//
// Two properties matter more than completeness here:
//
//   FUZZY. A diff's line numbers are a hint, not an address. The file has
//   usually moved since the model read it: an earlier hunk in the same turn,
//   a formatter, a concurrent edit. Insisting on the exact offset fails
//   patches that are perfectly applicable a few lines away.
//
//   ATOMIC. Either every hunk applies or the file is not touched. A
//   half-applied patch leaves a file that compiles as neither the old nor the
//   new version, and the model is told "failed" while the damage is already on
//   disk.

/** How far either side of the stated offset to look. Wide enough to absorb a
 *  hunk or two of drift, narrow enough that it cannot match a coincidentally
 *  similar block on the other side of a large file. */
const FUZZ_LINES = 20;

export interface Hunk {
  oldStart: number;
  newStart: number;
  /** ' ' context, '-' removed, '+' added. */
  lines: Array<{ kind: " " | "-" | "+"; text: string }>;
}

export type PatchResult =
  | { ok: true; content: string; added: number; removed: number }
  | { ok: false; reason: string };

const HEADER = /^@@\s*-(\d+)(?:,(\d+))?\s*\+(\d+)(?:,(\d+))?\s*@@/;

/** Pull the hunks out of a unified diff, ignoring the file headers: the tool
 *  already knows which file it is editing, and models are inconsistent about
 *  whether they include ---/+++ at all. */
export function parsePatch(
  patch: string,
): { ok: true; hunks: Hunk[] } | { ok: false; reason: string } {
  // The final newline terminates the last line, it is not a line of its own.
  // Splitting without removing it invents an empty context line at the end of
  // the last hunk, and since an empty line is read as context below, every
  // patch in the normal shape (git diff output ends with a newline) then fails
  // to match. Found when a one-line swap would not apply.
  const normalised = patch.replace(/\r\n/g, "\n").replace(/\n$/, "");
  const lines = normalised.split("\n");
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      if (current) hunks.push(current);
      current = { oldStart: Number(header[1]), newStart: Number(header[3]), lines: [] };
      continue;
    }
    if (!current) continue; // preamble: ---, +++, diff --git, index
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    const kind = line[0];
    if (kind === " " || kind === "-" || kind === "+") {
      current.lines.push({ kind, text: line.slice(1) });
    } else if (line === "") {
      // An empty line in a diff is a context line whose content is empty; the
      // leading space is frequently stripped in transit.
      current.lines.push({ kind: " ", text: "" });
    }
  }
  if (current) hunks.push(current);

  if (hunks.length === 0) {
    return { ok: false, reason: "No @@ hunk headers found, so this is not a unified diff." };
  }
  return { ok: true, hunks };
}

/** Does the hunk's "before" side sit at `at`? */
function matchesAt(fileLines: string[], expected: string[], at: number): boolean {
  if (at < 0 || at + expected.length > fileLines.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (fileLines[at + i] !== expected[i]) return false;
  }
  return true;
}

/** The stated offset first, then outward in step, nearest wins. */
function findHunk(fileLines: string[], expected: string[], hint: number): number {
  if (expected.length === 0) return Math.max(0, Math.min(hint, fileLines.length));
  if (matchesAt(fileLines, expected, hint)) return hint;
  for (let delta = 1; delta <= FUZZ_LINES; delta++) {
    if (matchesAt(fileLines, expected, hint - delta)) return hint - delta;
    if (matchesAt(fileLines, expected, hint + delta)) return hint + delta;
  }
  return -1;
}

export function applyPatch(original: string, patch: string): PatchResult {
  const parsed = parsePatch(patch);
  if (!parsed.ok) return parsed;

  // The trailing newline is preserved separately: splitting on "\n" turns a
  // file ending in a newline into an array with a trailing "", and rejoining
  // naively either keeps or drops it by accident.
  const endsWithNewline = original.endsWith("\n");
  const fileLines = (endsWithNewline ? original.slice(0, -1) : original).split("\n");

  // Applied to a copy. Nothing reaches the caller unless every hunk lands.
  let working = [...fileLines];
  // Earlier hunks change the line count, so later hints shift with them.
  let drift = 0;
  // Counted, not inferred from the file length: a patch that swaps one line
  // for another nets to zero, and reporting "+0 lines" reads as "nothing
  // happened" when something did.
  let added = 0;
  let removed = 0;

  for (const [index, hunk] of parsed.hunks.entries()) {
    const expected = hunk.lines.filter((l) => l.kind !== "+").map((l) => l.text);
    const replacement = hunk.lines.filter((l) => l.kind !== "-").map((l) => l.text);
    const hint = Math.max(0, hunk.oldStart - 1 + drift);

    const at = findHunk(working, expected, hint);
    if (at === -1) {
      return {
        ok: false,
        reason:
          `Hunk ${index + 1} of ${parsed.hunks.length} did not match within ${FUZZ_LINES} lines of ` +
          `line ${hunk.oldStart}. The file is not what the patch expects. Read it again and re-diff.`,
      };
    }

    working = [...working.slice(0, at), ...replacement, ...working.slice(at + expected.length)];
    drift += replacement.length - expected.length;
    added += hunk.lines.filter((l) => l.kind === "+").length;
    removed += hunk.lines.filter((l) => l.kind === "-").length;
  }

  const joined = working.join("\n");
  return { ok: true, content: endsWithNewline ? `${joined}\n` : joined, added, removed };
}
