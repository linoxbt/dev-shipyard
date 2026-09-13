import { paint } from "./render";

// The three pieces of a session screen that belong to the person rather than
// the agent, drawn the way Codex draws them:
//
//   the input row   one line, however much was pasted into it
//   a sent message  a shaded band with a marker, so what you asked stands
//                   apart from everything the agent says after it
//   the footer      model, folder, mode and cost, pinned to the bottom row
//                   instead of reprinted above every prompt
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

/** The input row: the prompt, a note while a paste is waiting to be sent, and
 *  a window onto the typed line that keeps the cursor on screen. */
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
    text: `${paint(opts.prompt, "brand", colour)}${note ? paint(note, "grey", colour) : ""}${visible}`,
    column: fixed + (cursor - start),
  };
}

/** A message the person sent, set apart: a shaded band with a marker, long
 *  pastes shortened to their first lines. */
export function messageBlock(text: string, columns: number, colour = false, maxLines = 8): string {
  const width = Math.max(20, Math.min(columns, 200));
  const raw = text.replace(/\s+$/, "").split("\n");
  const cut = raw.length > maxLines;
  const lines = cut
    ? [...raw.slice(0, maxLines - 1), `… +${raw.length - (maxLines - 1)} more lines`]
    : raw;
  const rows = lines.map((line, i) => {
    let body = `${i === 0 ? "›" : " "} ${line}`;
    if (body.length > width - 2) body = `${body.slice(0, width - 3)}…`;
    const padded = ` ${body}`.padEnd(width);
    if (!colour) return padded.trimEnd();
    const tone = cut && i === lines.length - 1 ? "90" : "97";
    return `${ESC}[48;5;236m${ESC}[${tone}m${padded}${ESC}[0m`;
  });
  return ["", ...rows, ""].join("\n");
}

export type SessionMode = "normal" | "auto" | "plan";

/** The footer: which mode is on, what the next message goes to, and how to
 *  change it. Shortened with an ellipsis rather than wrapped. */
export function footerLine(
  parts: { mode: SessionMode; model: string; path: string; costUsd?: number },
  columns: number,
  colour = false,
): string {
  const mode =
    parts.mode === "auto" ? "⏵⏵ auto mode" : parts.mode === "plan" ? "⏸ plan mode" : "normal mode";
  const items = [parts.model, parts.path];
  if (parts.costUsd && parts.costUsd > 0) items.push(`$${parts.costUsd.toFixed(2)}`);
  items.push("/ commands", "shift+tab mode");
  const head = ` ${mode}`;
  let rest = ` · ${items.join(" · ")}`;
  const width = Math.max(20, columns - 1);
  if (head.length + rest.length > width) {
    rest = `${rest.slice(0, Math.max(0, width - head.length - 1))}…`;
  }
  return `${paint(head, parts.mode === "normal" ? "grey" : "brand", colour)}${paint(rest, "grey", colour)}`;
}
