import { paint } from "./render";

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
const COLOUR_CODE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Width on screen, ignoring colour codes. */
export function visibleLength(text: string): number {
  return text.replace(COLOUR_CODE, "").length;
}

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
  const width = Math.max(10, opts.columns - fixed - 1);
  const cursor = Math.max(0, Math.min(opts.cursor, opts.line.length));
  const start = cursor > width ? cursor - width : 0;
  const visible = opts.line.slice(start, start + width);
  return {
    text: `${opts.prompt}${note ? paint(note, "grey", colour) : ""}${visible}`,
    column: fixed + (cursor - start),
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
    opts.input,
    paint("─".repeat(width), "grey", colour),
    opts.footer,
    ...(opts.menu ?? []),
  ];
}

/** A message the person sent, set apart: a shaded band with a ❯, long pastes
 *  shortened to their first lines. */
export function messageBlock(text: string, columns: number, colour = false, maxLines = 8): string {
  const width = Math.max(20, Math.min(columns, 200));
  const raw = text.replace(/\s+$/, "").split("\n");
  const cut = raw.length > maxLines;
  const lines = cut
    ? [...raw.slice(0, maxLines - 1), `… +${raw.length - (maxLines - 1)} more lines`]
    : raw;
  const rows = lines.map((line, i) => {
    let body = `${i === 0 ? "❯" : " "} ${line}`;
    if (body.length > width - 2) body = `${body.slice(0, width - 3)}…`;
    const padded = ` ${body}`.padEnd(width);
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
  const width = Math.max(20, columns - 1);
  const room = width - left.length - 2;
  if (room < 8) right = "";
  else if (right.length > room) right = `${right.slice(0, room - 1)}…`;
  const gap = right ? " ".repeat(Math.max(2, width - left.length - right.length)) : "";
  const leftColour = parts.mode === "normal" ? "grey" : "brand";
  return `${paint(left, leftColour, colour)}${gap}${paint(right, "grey", colour)}`;
}
