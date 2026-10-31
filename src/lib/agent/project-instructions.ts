// A project's own instructions for agents: AGENTS.md at the workspace root
// (the common convention), or CLAUDE.md when that is what the project keeps.
// Read at the start of every run so a fresh agent picks up the conventions,
// commands and working rules without the earlier conversation. Bounded, and
// only the root file: the agent reads anything deeper when a task needs it.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILES = ["AGENTS.md", "CLAUDE.md"];
const MAX_CHARS = 8_000;

export function readProjectInstructions(root: string): string {
  for (const name of FILES) {
    let text: string;
    try {
      text = readFileSync(join(root, name), "utf8").trim();
    } catch {
      continue;
    }
    if (!text) continue;
    const clipped =
      text.length > MAX_CHARS
        ? `${text.slice(0, MAX_CHARS)}\n…(cut; read ${name} for the rest)`
        : text;
    return `\n\nThis project's instructions for agents (${name}). Follow them unless they conflict with the rules above or with what the person asks now:\n<project-instructions>\n${clipped}\n</project-instructions>`;
  }
  return "";
}
