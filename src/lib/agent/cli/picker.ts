import { paint } from "./render";

// Choosing from a short list with the arrow keys, the way Codex asks for a
// permission: the options are drawn under the question, ↑ and ↓ move the
// marker, Enter confirms, and the number or letter beside an option picks it
// straight away. Esc and Ctrl-C pick the last option, which is always the
// safe one ("No").
//
// The logic is pure so it can be tested without a terminal; index.ts owns the
// raw keypress wiring.

export interface Choice {
  label: string;
  /** A letter that picks this option directly. */
  key?: string;
}

export interface KeyInfo {
  name?: string;
  sequence?: string;
  ctrl?: boolean;
  meta?: boolean;
}

export const APPROVAL_CHOICES: Choice[] = [
  { label: "Yes, proceed", key: "y" },
  { label: "Yes, and don't ask again this session", key: "a" },
  { label: "No, skip it", key: "n" },
];

export const PLAN_CHOICES: Choice[] = [
  { label: "Yes, carry out this plan", key: "y" },
  { label: "No, keep planning", key: "n" },
];

/** What a key does to the selection. `done` is the chosen index. */
export function pickerKey(
  key: KeyInfo,
  selected: number,
  choices: Choice[],
): { selected: number; done?: number } {
  const count = choices.length;
  const last = count - 1;
  if (key.ctrl && key.name === "c") return { selected: last, done: last };
  switch (key.name) {
    case "up":
      return { selected: (selected - 1 + count) % count };
    case "down":
    case "tab":
      return { selected: (selected + 1) % count };
    case "return":
    case "enter":
      return { selected, done: selected };
    case "escape":
      return { selected: last, done: last };
    default:
      break;
  }
  const typed = (key.sequence ?? "").toLowerCase();
  if (/^[1-9]$/.test(typed) && Number(typed) <= count) {
    const index = Number(typed) - 1;
    return { selected: index, done: index };
  }
  const hot = choices.findIndex((choice) => choice.key !== undefined && choice.key === typed);
  if (hot >= 0) return { selected: hot, done: hot };
  return { selected };
}

/** The options, with the marker on the selected one, and a line saying how. */
export function renderPicker(
  choices: Choice[],
  selected: number,
  colour = false,
  finished = false,
): string[] {
  const lines = choices.map((choice, i) => {
    const label = `${i + 1}. ${choice.label}`;
    const hint = choice.key ? ` ${paint(`(${choice.key})`, "grey", colour)}` : "";
    return i === selected
      ? `${paint("›", "brand", colour)} ${paint(label, "bold", colour)}${hint}`
      : `  ${paint(label, finished ? "grey" : "reset", colour)}${hint}`;
  });
  lines.push(
    paint(finished ? "" : "  ↑/↓ to choose, Enter to confirm, Esc to decline", "grey", colour),
  );
  return lines;
}
