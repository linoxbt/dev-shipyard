// Cutting a file into pieces worth retrieving.
//
// The plan called for tree-sitter. It is not here, deliberately: it means a
// native binding or a wasm grammar per language, fetched at build time, in a
// project whose build already runs close to this machine's memory ceiling. The
// cost is real and the benefit for this job is smaller than it looks, because
// what retrieval needs is "a whole function with its name and its comment",
// not a faithful syntax tree.
//
// So: a structural pass that finds top-level declarations by brace balance or
// by indentation, and a line-window fallback for anything it does not
// recognise. Every chunk carries the lines it came from, so a wrong guess
// degrades into "slightly the wrong window", never into a wrong answer about
// where something lives. If tree-sitter earns its place later, it replaces
// `structuralChunks` and nothing else.

export type ChunkKind = "declaration" | "section" | "window";

export interface Chunk {
  path: string;
  /** 1-based, inclusive, so it can be quoted back as `path:start-end`. */
  startLine: number;
  endLine: number;
  kind: ChunkKind;
  /** The declaration's name where one was found. Retrieval weights it. */
  name: string | null;
  text: string;
}

const BRACE_LANGUAGES = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "java",
  "go",
  "rs",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "cs",
  "php",
  "swift",
  "kt",
  "scala",
  "dart",
]);

const INDENT_LANGUAGES = new Set(["py", "rb"]);

export function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Roughly four characters to the token. Used to keep a chunk inside something
 *  a model can actually be given, not to bill anyone. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MAX_CHUNK_LINES = 120;
const WINDOW_LINES = 60;
const WINDOW_OVERLAP = 10;

/** A line that starts a top-level declaration in a brace language. Deliberately
 *  loose: a false positive costs a slightly odd chunk boundary, a false
 *  negative costs a whole function's worth of retrievable text. */
const DECLARATION =
  /^(?:export\s+)?(?:default\s+)?(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|abstract\s+|final\s+|async\s+|declare\s+)*(?:function|class|interface|type|enum|struct|impl|trait|const|let|var|def|func|fn|record|namespace|module)\b/;

const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|#|--)/;

function nameFrom(line: string): string | null {
  const match =
    /\b(?:function|class|interface|type|enum|struct|impl|trait|const|let|var|def|func|fn|record|namespace|module)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(
      line,
    ) ?? /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)/.exec(line);
  return match ? match[1] : null;
}

/** Strings and comments hold braces that are not structure. Counting them is
 *  how a chunker swallows the rest of a file. */
function braceDelta(line: string): number {
  let delta = 0;
  let inString: string | null = null;
  let inBlockComment = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (char === "\\") i++;
      else if (char === inString) inString = null;
      continue;
    }
    if (char === "/" && next === "/") break; // rest of the line is a comment
    if (char === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }
    if (char === "{") delta++;
    else if (char === "}") delta--;
  }
  return delta;
}

/** How far back the comment block above a declaration goes. A function without
 *  its doc comment loses most of what made it findable. */
function commentStart(lines: string[], at: number): number {
  let start = at;
  for (let i = at - 1; i >= 0; i--) {
    const line = lines[i];
    if (COMMENT_LINE.test(line)) start = i;
    else if (line.trim() === "" && start !== at) continue;
    else break;
  }
  return start;
}

function braceChunks(path: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!DECLARATION.test(line)) {
      index++;
      continue;
    }

    const from = commentStart(lines, index);
    let depth = 0;
    let end = index;
    let opened = false;

    for (let i = index; i < lines.length && i < index + MAX_CHUNK_LINES; i++) {
      depth += braceDelta(lines[i]);
      end = i;
      if (depth > 0) opened = true;
      // The body closed.
      if (opened && depth <= 0) break;
      if (opened) continue;

      // No body yet. Either this declaration has none (a const, a type alias)
      // and ends here, or its signature runs over several lines and the brace
      // is still to come. Getting this wrong is how `const ROOT = "/srv";`
      // swallowed the function declared after it.
      const trimmed = lines[i].trim();
      const next = lines[i + 1];
      const ends =
        trimmed.endsWith(";") || next === undefined || next.trim() === "" || DECLARATION.test(next);
      if (ends) break;
    }

    chunks.push(make(path, lines, from, end, "declaration", nameFrom(line)));
    index = end + 1;
  }
  return chunks;
}

function indentChunks(path: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const starts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (/^(?:async\s+)?(?:def|class)\s/.test(lines[i])) starts.push(i);
  }

  for (let s = 0; s < starts.length; s++) {
    const from = commentStart(lines, starts[s]);
    // A top-level block runs until the next top-level block, or the end.
    const end = (starts[s + 1] ?? lines.length) - 1;
    chunks.push(
      make(
        path,
        lines,
        from,
        Math.min(end, starts[s] + MAX_CHUNK_LINES - 1),
        "declaration",
        nameFrom(lines[starts[s]]),
      ),
    );
  }
  return chunks;
}

function markdownChunks(path: string, lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  const starts: number[] = [];
  for (let i = 0; i < lines.length; i++) if (/^#{1,6}\s/.test(lines[i])) starts.push(i);
  if (starts.length === 0) return [];

  // Anything before the first heading is a section of its own, not lost.
  if (starts[0] > 0) chunks.push(make(path, lines, 0, starts[0] - 1, "section", null));

  for (let s = 0; s < starts.length; s++) {
    const end = (starts[s + 1] ?? lines.length) - 1;
    const heading = lines[starts[s]].replace(/^#+\s*/, "").trim();
    chunks.push(make(path, lines, starts[s], end, "section", heading || null));
  }
  return chunks;
}

function windowChunks(path: string, lines: string[], from = 0, to = lines.length - 1): Chunk[] {
  const chunks: Chunk[] = [];
  const step = Math.max(1, WINDOW_LINES - WINDOW_OVERLAP);
  for (let start = from; start <= to; start += step) {
    const end = Math.min(to, start + WINDOW_LINES - 1);
    chunks.push(make(path, lines, start, end, "window", null));
    if (end >= to) break;
  }
  return chunks;
}

function make(
  path: string,
  lines: string[],
  from: number,
  to: number,
  kind: ChunkKind,
  name: string | null,
): Chunk {
  return {
    path,
    startLine: from + 1,
    endLine: to + 1,
    kind,
    name,
    text: lines.slice(from, to + 1).join("\n"),
  };
}

/** Anything the structural pass left uncovered, as windows. A file is not
 *  only its declarations: the imports, the constants and the top-level wiring
 *  are often exactly what a question is about. */
function fillGaps(path: string, lines: string[], found: Chunk[]): Chunk[] {
  if (found.length === 0) return windowChunks(path, lines);
  const covered = new Array<boolean>(lines.length).fill(false);
  for (const chunk of found) {
    for (let i = chunk.startLine - 1; i <= chunk.endLine - 1; i++) covered[i] = true;
  }

  const extra: Chunk[] = [];
  let runStart: number | null = null;
  for (let i = 0; i <= lines.length; i++) {
    const isGap = i < lines.length && !covered[i];
    if (isGap && runStart === null) runStart = i;
    if (!isGap && runStart !== null) {
      const slice = lines.slice(runStart, i);
      // A gap of blank lines is not worth a chunk.
      if (slice.some((l) => l.trim() !== ""))
        extra.push(...windowChunks(path, lines, runStart, i - 1));
      runStart = null;
    }
  }
  return extra;
}

export function chunkFile(path: string, content: string): Chunk[] {
  const lines = content.split("\n");
  if (content.trim() === "") return [];

  const extension = extensionOf(path);
  let found: Chunk[];
  if (BRACE_LANGUAGES.has(extension)) found = braceChunks(path, lines);
  else if (INDENT_LANGUAGES.has(extension)) found = indentChunks(path, lines);
  else if (extension === "md" || extension === "mdx") found = markdownChunks(path, lines);
  else found = [];

  const all = [...found, ...fillGaps(path, lines, found)];

  // Oversized chunks are windowed rather than truncated: a chunk that is cut
  // off in the middle is worse than two that overlap.
  const sized: Chunk[] = [];
  for (const chunk of all) {
    const span = chunk.endLine - chunk.startLine + 1;
    if (span <= MAX_CHUNK_LINES) sized.push(chunk);
    else sized.push(...windowChunks(path, lines, chunk.startLine - 1, chunk.endLine - 1));
  }

  return sized
    .filter((c) => c.text.trim() !== "")
    .sort((a, b) => a.startLine - b.startLine || a.endLine - b.endLine);
}
