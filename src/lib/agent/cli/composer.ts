import { paint } from "./render";
import { displayWidth, fitWidth } from "./width";

// The parts of a session screen that belong to the person rather than the
// agent, drawn the way Claude Code draws them:
//
//   the input box   a rule, the ❯ prompt, a rule, and the footer under it,
//                   following the conversation rather than pinned to the
//                   screen; a pasted brief is one line while it is written
//   a sent message  a shaded band with a ❯, so what you asked stands apart
//                   from everything the agent says after it
//   the footer      the mode on the left, model, folder and cost on the right
//
// Pure functions of their inputs, so they are tested without a terminal;
// index.ts owns the cursor.

const ESC = String.fromCharCode(27);

/** Width on screen in cells, ignoring colour codes. Every line here is drawn
 *  narrower than the terminal: one that wraps breaks the redraw, and a rule is
 *  left behind on every keypress. */
export const visibleLength = displayWidth;

export interface ComposerView {
  text: string;
  /** Where the cursor goes, counted from the left edge. */
  column: number;
}

/** The input line: the prompt, a note while a paste is waiting to be sent,
 *  and a window onto the typed line that keeps the cursor on screen. */
export function composerView(opts: {
  prompt: string;
  line: string;
  cursor: number;
  columns: number;
  pastedLines?: number;
  colour?: boolean;
}): ComposerView {
  const colour = opts.colour ?? false;
  const note = opts.pastedLines ? `[Pasted ${opts.pastedLines} lines] ` : "";
  const fixed = visibleLength(opts.prompt) + note.length;
  const width = Math.max(10, opts.columns - fixed - 2);
  const cursor = Math.max(0, Math.min(opts.cursor, opts.line.length));
  let start = cursor > width ? cursor - width : 0;
  // Wide characters take two cells: move the window on until what is before
  // the cursor fits.
  while (start < cursor && displayWidth(opts.line.slice(start, cursor)) > width) start++;
  let visible = opts.line.slice(start, start + width);
  while (visible && displayWidth(visible) > width) visible = visible.slice(0, -1);
  return {
    text: `${opts.prompt}${note ? paint(note, "grey", colour) : ""}${visible}`,
    column: fixed + displayWidth(opts.line.slice(start, cursor)),
  };
}

/** The whole input box, top to bottom: rule (with a title on the right),
 *  input line, rule, footer, then the command list when "/" is being typed. */
export function boxLines(opts: {
  input: string;
  footer: string;
  columns: number;
  title?: string;
  menu?: string[];
  colour?: boolean;
}): string[] {
  const colour = opts.colour ?? false;
  const width = Math.max(20, opts.columns - 1);
  const title = opts.title ? ` ${opts.title.slice(0, Math.max(0, width - 10))} ` : "";
  const top = title ? `${"─".repeat(width - title.length - 1)}${title}─` : "─".repeat(width);
  return [
    paint(top, "grey", colour),
    fitWidth(opts.input, width - 1),
    paint("─".repeat(width), "grey", colour),
    // Two more cells spare: ⏵⏵ and ⏸ are drawn two wide by some terminals.
    fitWidth(opts.footer, width - 2),
    ...(opts.menu ?? []).map((line) => fitWidth(line, width - 1)),
  ];
}

/** A message the person sent, set apart: a shaded band with a ❯, long pastes
 *  shortened to their first lines. */
export function messageBlock(text: string, columns: number, colour = false, maxLines = 8): string {
  // One cell short of the edge, so an emoji the terminal draws wide never wraps.
  const width = Math.max(20, Math.min(columns - 1, 200));
  const raw = text.replace(/\s+$/, "").split("\n");
  const cut = raw.length > maxLines;
  const lines = cut
    ? [...raw.slice(0, maxLines - 1), `… +${raw.length - (maxLines - 1)} more lines`]
    : raw;
  const rows = lines.map((line, i) => {
    const body = fitWidth(`${i === 0 ? "❯" : " "} ${line.replace(/\t/g, "  ")}`, width - 2);
    const padded = ` ${body}${" ".repeat(Math.max(0, width - 1 - displayWidth(body)))}`;
    if (!colour) return padded.trimEnd();
    const tone = cut && i === lines.length - 1 ? "90" : "97";
    return `${ESC}[48;5;236m${ESC}[${tone}m${padded}${ESC}[0m`;
  });
  return ["", ...rows, ""].join("\n");
}

export type SessionMode = "normal" | "auto" | "plan";

/** The footer under the box: the mode and how to change it on the left; the
 *  model, folder and cost on the right, shortened before the left ever is. */
export function footerLine(
  parts: { mode: SessionMode; model: string; path: string; costUsd?: number },
  columns: number,
  colour = false,
): string {
  const left =
    parts.mode === "auto"
      ? "  ⏵⏵ auto mode on (shift+tab to cycle)"
      : parts.mode === "plan"
        ? "  ⏸ plan mode on (shift+tab to cycle)"
        : "  / for commands · shift+tab to cycle modes";
  const items = [parts.model, parts.path];
  if (parts.costUsd && parts.costUsd > 0) items.push(`$${parts.costUsd.toFixed(2)}`);
  let right = items.join(" · ");
  // Three cells short of the edge: the mode glyphs are drawn two wide by some
  // terminals, and a footer that wraps leaves a rule behind on every keypress.
  const width = Math.max(20, columns - 3);
  const room = width - displayWidth(left) - 2;
  if (room < 8) right = "";
  else if (displayWidth(right) > room) right = fitWidth(right, room);
  const gap = right
    ? " ".repeat(Math.max(2, width - displayWidth(left) - displayWidth(right)))
    : "";
  const leftColour = parts.mode === "normal" ? "grey" : "brand";
  return `${paint(left, leftColour, colour)}${gap}${paint(right, "grey", colour)}`;
}
