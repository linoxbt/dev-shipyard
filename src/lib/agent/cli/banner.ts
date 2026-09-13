import { CLI_NAME, VERSION } from "./args";
import { paint } from "./render";

// The thing you see first.
//
// Rendered from a bitmap rather than pasted in as art, because hand-written
// block letters drift a row and nobody notices until it is on somebody's
// screen. A grid cannot drift.
//
// It also has to survive being small and being piped. A 48-column wordmark in
// a 40-column terminal is a mess of wrapped lines, and the same art in a log
// file is noise, so both cases get the one-line form instead.

/** 5 rows per letter, 1 for ink. Only the letters DEVSTATION needs. */
const GLYPHS: Record<string, string[]> = {
  D: ["1110", "1001", "1001", "1001", "1110"],
  E: ["1111", "1000", "1110", "1000", "1111"],
  V: ["1001", "1001", "1001", "1001", "0110"],
  S: ["0111", "1000", "0110", "0001", "1110"],
  T: ["1111", "0110", "0110", "0110", "0110"],
  A: ["0110", "1001", "1111", "1001", "1001"],
  I: ["111", "010", "010", "010", "111"],
  O: ["0110", "1001", "1001", "1001", "0110"],
  N: ["1001", "1101", "1011", "1001", "1001"],
};

const WORDMARK = "DEVSTATION";

export function wordmark(ink = "█"): string[] {
  const rows = ["", "", "", "", ""];
  WORDMARK.split("").forEach((letter, index) => {
    const glyph = GLYPHS[letter];
    for (let row = 0; row < 5; row++) {
      rows[row] += glyph[row].replace(/1/g, ink).replace(/0/g, " ");
      if (index < WORDMARK.length - 1) rows[row] += " ";
    }
  });
  return rows;
}

export const WORDMARK_WIDTH = wordmark()[0].length;

export interface BannerFacts {
  model: string | null;
  /** How commands will run. The weaker of the two needs saying out loud more
   *  than the stronger one does. */
  executor?: string;
  workspace: string;
  /** Null when nothing has been indexed here yet. */
  indexed?: number | null;
  memory?: number;
}

/** Home is where most people work, and the full path is noise there. */
export function shortPath(path: string, home = process.env.HOME ?? ""): string {
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

export function banner(facts: BannerFacts, options: { columns?: number; colour?: boolean } = {}) {
  // `||` and not `??`: a terminal that reports 0 columns is not telling us it
  // has none, it is telling us it does not know. A pty with no window size set
  // does exactly that, and `??` let the 0 through and showed everyone the
  // cramped banner.
  const columns = options.columns || process.stdout.columns || 80;
  const colour = options.colour ?? false;
  const model = facts.model ?? "no model configured";
  const where = shortPath(facts.workspace);

  // Anything narrower than the wordmark plus a margin gets the short form.
  if (columns < WORDMARK_WIDTH + 4) {
    return [
      paint(`${CLI_NAME} v${VERSION}`, "bold", colour),
      paint(model, "dim", colour),
      paint(where, "dim", colour),
      "",
    ].join("\n");
  }

  const details = [
    `v${VERSION}`,
    model,
    where,
    facts.indexed ? `${facts.indexed} chunks indexed` : null,
    facts.memory ? `${facts.memory} notes` : null,
    facts.executor ?? null,
  ].filter(Boolean) as string[];

  // Wrapped rather than allowed to run off the edge: a details line that the
  // terminal folds mid-path is harder to read than two tidy ones.
  const lines: string[] = [];
  let current = "  the coding agent";
  for (const detail of details) {
    if (current.length + detail.length + 2 > columns - 2) {
      lines.push(current);
      current = "  ";
    }
    current += `  ${detail}`;
  }
  lines.push(current);

  const art = wordmark().map((row) => paint(row, "brand", colour));

  return ["", ...art, "", ...lines.map((line) => paint(line, "dim", colour)), ""].join("\n");
}

/** What to say once, under the banner, so a new user knows what to type. */
export function openingHelp(colour = false): string {
  return [
    paint("  Ask anything, or say what you want built, and press Enter.", "dim", colour),
    paint(
      "  Type / for commands · Shift+Tab switches auto and plan mode · Ctrl-C interrupts · /exit leaves.",
      "dim",
      colour,
    ),
    "",
  ].join("\n");
}

/** The rule above the input: what the next message goes to, at a glance. */
export function promptRule(
  label: string,
  options: { columns?: number; colour?: boolean } = {},
): string {
  const width = Math.max(20, Math.min(options.columns ?? 80, 200));
  let text = `── ${label} `;
  if (text.length > width) text = `${text.slice(0, width - 2)}… `;
  return `${paint(text + "─".repeat(Math.max(0, width - text.length)), "dim", options.colour ?? false)}\n`;
}
