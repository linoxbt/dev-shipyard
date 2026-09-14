// How wide text is on screen, and cutting it to fit.
//
// Everything redrawn in place -- the status line, the input box, the picker --
// assumes one line is one row. A line even one cell wider than the terminal
// wraps onto a second row, the redraw clears only one of them, and the other is
// left behind: a status line repeated down the screen on every tick, a rule
// stacked on every keypress. `.length` counts code units, not cells, so an
// emoji such as 1️⃣ or a CJK character was enough to cause it on a terminal only
// a little narrower than the line.

const ESC = String.fromCharCode(27);
const ANSI = new RegExp(`^${ESC}\\[[0-9;?]*[A-Za-z]`);

const ZERO_WIDTH: Array<[number, number]> = [
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0x20d0, 0x20ff],
  [0xfe00, 0xfe0f],
  [0xe0020, 0xe007f],
];

// East Asian wide characters, and symbols shown as emoji by default.
const WIDE: Array<[number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b],
  [0x23e9, 0x23ec],
  [0x23f0, 0x23f0],
  [0x23f3, 0x23f3],
  [0x25fd, 0x25fe],
  [0x2614, 0x2615],
  [0x2648, 0x2653],
  [0x267f, 0x267f],
  [0x2693, 0x2693],
  [0x26a1, 0x26a1],
  [0x26aa, 0x26ab],
  [0x26bd, 0x26be],
  [0x26c4, 0x26c5],
  [0x26ce, 0x26ce],
  [0x26d4, 0x26d4],
  [0x26ea, 0x26ea],
  [0x26f2, 0x26f5],
  [0x26fa, 0x26fa],
  [0x26fd, 0x26fd],
  [0x2705, 0x2705],
  [0x270a, 0x270b],
  [0x2728, 0x2728],
  [0x274c, 0x274c],
  [0x274e, 0x274e],
  [0x2753, 0x2757],
  [0x2795, 0x2797],
  [0x27b0, 0x27b0],
  [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50],
  [0x2b55, 0x2b55],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x1faff],
  [0x20000, 0x3fffd],
];

const within = (cp: number, ranges: Array<[number, number]>) =>
  ranges.some(([lo, hi]) => cp >= lo && cp <= hi);

function charWidth(cp: number): number {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (within(cp, ZERO_WIDTH) || cp === 0x200d) return 0;
  return within(cp, WIDE) ? 2 : 1;
}

/** Walks text as (piece, cells) pairs: colour codes are zero cells, and a
 *  variation selector asking for emoji makes the character before it two. */
function* cells(text: string): Generator<[string, number]> {
  let i = 0;
  let previous = 0;
  while (i < text.length) {
    if (text[i] === ESC) {
      const code = ANSI.exec(text.slice(i));
      if (code) {
        yield [code[0], 0];
        i += code[0].length;
        continue;
      }
    }
    const cp = text.codePointAt(i) as number;
    const piece = String.fromCodePoint(cp);
    i += piece.length;
    let width = charWidth(cp);
    if (cp === 0xfe0f && previous === 1) width = 1;
    previous = width === 0 ? previous : width;
    yield [piece, width];
  }
}

/** Cells on screen, ignoring colour codes. */
export function displayWidth(text: string): number {
  let total = 0;
  for (const [, width] of cells(text)) total += width;
  return total;
}

/** The text cut to at most `max` cells, with an ellipsis where it was cut and
 *  colour reset so the cut does not bleed into what follows. */
export function fitWidth(text: string, max: number): string {
  if (displayWidth(text) <= max) return text;
  let out = "";
  let used = 0;
  for (const [piece, width] of cells(text)) {
    if (width === 0) {
      if (piece.startsWith(ESC)) out += piece;
      else if (used > 0) out += piece;
      continue;
    }
    if (used + width > max - 1) break;
    out += piece;
    used += width;
  }
  return `${out}…${text.includes(ESC) ? `${ESC}[0m` : ""}`;
}
