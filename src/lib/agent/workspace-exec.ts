import { applyPatch } from "./patch";
import { Workspace } from "./workspace";

// Running the file tools against a real workspace.
//
// The counterpart to appgen's tool-exec, which works over an in-memory file
// map because generated apps live in one. This one works over a directory, so
// the same tool names mean the same thing whether the agent is building a new
// app or editing a repository that already existed.
//
// Every result is a string, because that is what goes back to the model. A
// failure is a readable sentence rather than a thrown error: the model should
// read what went wrong and correct itself, which it cannot do with a stack
// trace it never sees.

const MAX_MATCHES = 40;
const MAX_LINE = 200;

export interface WorkspaceExecResult {
  ok: boolean;
  output: string;
}

function fail(reason: string): WorkspaceExecResult {
  return { ok: false, output: reason };
}

export function executeFileTool(
  workspace: Workspace,
  name: string,
  args: Record<string, unknown>,
): WorkspaceExecResult | null {
  switch (name) {
    case "list_files": {
      // One more than shown, so "exactly the limit" and "more than the limit"
      // can be told apart without walking the rest of a huge tree.
      const LIMIT = 2000;
      const files = workspace.list(String(args.path ?? "."), LIMIT + 1);
      if (files.length === 0) return { ok: true, output: "The workspace is empty." };
      if (files.length > LIMIT) {
        return {
          ok: true,
          output:
            `${files.slice(0, LIMIT).join("\n")}\n\n` +
            `(Stopped at ${LIMIT} files: this directory is very large. List a subdirectory, or search for what you need.)`,
        };
      }
      return { ok: true, output: files.join("\n") };
    }

    case "read_file": {
      const result = workspace.read(String(args.path ?? ""));
      return result.ok ? { ok: true, output: result.content } : fail(result.reason);
    }

    case "write_file": {
      const path = String(args.path ?? "");
      const result = workspace.write(path, String(args.content ?? ""));
      return result.ok ? { ok: true, output: `Wrote ${path}.` } : fail(result.reason);
    }

    case "edit_file": {
      const path = String(args.path ?? "");
      const current = workspace.read(path);
      if (!current.ok) return fail(current.reason);

      const patched = applyPatch(current.content, String(args.patch ?? ""));
      // Nothing is written unless the whole patch applied. applyPatch returns
      // no partial content, so there is nothing here that could be written by
      // mistake.
      if (!patched.ok) return fail(patched.reason);

      const written = workspace.write(path, patched.content);
      if (!written.ok) return fail(written.reason);

      return {
        ok: true,
        output: `Patched ${path} (+${patched.added} / -${patched.removed} lines).`,
      };
    }

    case "delete_file": {
      // Deliberately not implemented here. Deletion is gated, and the gate
      // decides before execution; routing it through the same switch as the
      // safe tools invites it being called without one.
      return null;
    }

    case "search_files": {
      const query = String(args.query ?? "").toLowerCase();
      if (!query) return fail("No search query was given.");
      const hits: string[] = [];
      let truncated = false;
      // Bounded like list_files, for the same reason: in a home directory the
      // tree is half a million files, and reading each one looked like a hang.
      const MAX_SCAN = 20_000;
      const scanned = workspace.list(".", MAX_SCAN + 1);
      const scanLimited = scanned.length > MAX_SCAN;
      for (const path of scanned.slice(0, MAX_SCAN)) {
        const file = workspace.read(path);
        // Skip what cannot be read as text rather than reporting it as a miss.
        if (!file.ok) continue;
        const lines = file.content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].toLowerCase().includes(query)) continue;
          if (hits.length >= MAX_MATCHES) {
            truncated = true;
            break;
          }
          const line = lines[i].trim();
          hits.push(
            `${path}:${i + 1}: ${line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line}`,
          );
        }
        if (truncated) break;
      }
      // Said even when nothing matched: "no match" is not true of files that
      // were never read.
      const scanNote = scanLimited
        ? `\n\n(Searched the first ${MAX_SCAN} files only: this workspace is very large. Search a subdirectory.)`
        : "";
      if (hits.length === 0) {
        return { ok: true, output: `No match for "${args.query}".${scanNote}` };
      }
      return {
        ok: true,
        output: `${truncated ? `${hits.join("\n")}\n… more matches not shown` : hits.join("\n")}${scanNote}`,
      };
    }

    default:
      // Not a file tool. The caller handles builds, tests and the outward
      // tools; returning null keeps that decision in one place.
      return null;
  }
}
