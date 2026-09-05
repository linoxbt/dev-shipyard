// Running the inspection tools against the project.
//
// Pure over the file map on purpose: these answer questions about the code, and
// nothing here writes, builds or reaches the network. That makes the whole
// surface testable without a runner, and it means a bug in this file cannot
// damage a project: the worst it can do is answer a question badly.
//
// Writing and deleting are NOT here. Files are produced by the generator as
// complete fenced blocks, which is the part of this pipeline that is most
// carefully tuned, and building runs through the caller's own toolchain hook.
// This file is the "look" half of look-then-write.

/** Caps on what one lookup may return. A tool result goes into the next
 *  prompt, so an unbounded answer costs context that the code itself needs. */
const MAX_MATCHES = 40;
const MAX_LINE = 200;

export interface InspectionContext {
  files: Record<string, string>;
  /** Workspace prefix, stripped from anything shown so the model sees the same
   *  paths it writes. */
  dir: string;
}

function strip(path: string, dir: string): string {
  const prefix = dir ? `${dir}/` : "";
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

/** Resolve a path the model gave, with or without the workspace prefix. */
export function resolvePath(given: string, ctx: InspectionContext): string | null {
  const prefix = ctx.dir ? `${ctx.dir}/` : "";
  const candidates = [given, `${prefix}${given}`];
  for (const c of candidates) if (c in ctx.files) return c;
  return null;
}

export function listFiles(ctx: InspectionContext): string {
  const names = Object.keys(ctx.files).sort();
  if (names.length === 0) return "The project is empty.";
  return names
    .map((p) => `${strip(p, ctx.dir)} (${ctx.files[p].split("\n").length} lines)`)
    .join("\n");
}

export function readFile(path: string, ctx: InspectionContext): string {
  const resolved = resolvePath(path, ctx);
  if (!resolved) {
    // Naming what IS there turns a wrong guess into a correction rather than a
    // dead end.
    const names = Object.keys(ctx.files)
      .map((p) => strip(p, ctx.dir))
      .sort();
    return `There is no file at ${path}. The project has: ${names.join(", ") || "nothing"}.`;
  }
  const body = ctx.files[resolved];
  return body.length === 0 ? `${strip(resolved, ctx.dir)} is empty.` : body;
}

export function searchFiles(query: string, ctx: InspectionContext): string {
  const needle = query.toLowerCase();
  const hits: string[] = [];
  let truncated = false;

  for (const path of Object.keys(ctx.files).sort()) {
    const lines = ctx.files[path].split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      if (hits.length >= MAX_MATCHES) {
        truncated = true;
        break;
      }
      const line = lines[i].trim();
      hits.push(
        `${strip(path, ctx.dir)}:${i + 1}: ${line.length > MAX_LINE ? `${line.slice(0, MAX_LINE)}…` : line}`,
      );
    }
    if (truncated) break;
  }

  if (hits.length === 0) return `No match for "${query}".`;
  return truncated ? `${hits.join("\n")}\n… more matches not shown` : hits.join("\n");
}

/** Dispatch for the read-only tools. Anything else is the caller's to handle;
 *  returning null rather than throwing keeps the decision in one place. */
export function runInspection(
  name: string,
  args: Record<string, unknown>,
  ctx: InspectionContext,
): string | null {
  switch (name) {
    case "list_files":
      return listFiles(ctx);
    case "read_file":
      return readFile(String(args.path ?? ""), ctx);
    case "search_files":
      return searchFiles(String(args.query ?? ""), ctx);
    default:
      return null;
  }
}
