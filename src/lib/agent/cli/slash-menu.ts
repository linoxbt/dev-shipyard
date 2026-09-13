import { SLASH_COMMANDS } from "./args";
import { paint } from "./render";

// The list of commands shown under the prompt as soon as "/" is typed, narrowed
// as more is typed: "/re" shows /resume and /rename. The same list the help,
// Tab completion and "did you mean" read, plus the skills found in the project.

export interface MenuItem {
  name: string;
  args?: string;
  help: string;
  aliases?: string[];
}

export function slashMenuItems(skills: string[] = []): MenuItem[] {
  const commands = SLASH_COMMANDS.map((c) => ({
    name: c.name,
    args: c.args,
    help: c.help,
    aliases: c.aliases,
  }));
  const taken = new Set(commands.flatMap((c) => [c.name, ...(c.aliases ?? [])]));
  const skillItems = skills
    .filter((name) => !taken.has(name))
    .map((name) => ({ name, help: "run this skill" }));
  return [...commands, ...skillItems];
}

/** Lines to draw under the input, or none when the input is not a command
 *  being typed. */
export function slashMenuLines(
  line: string,
  items: MenuItem[],
  opts: { colour?: boolean; maxRows?: number } = {},
): string[] {
  if (!line.startsWith("/") || /\s/.test(line)) return [];
  const colour = opts.colour ?? false;
  const prefix = line.slice(1).toLowerCase();
  const matches = items.filter(
    (item) =>
      item.name.startsWith(prefix) ||
      (item.aliases ?? []).some((alias) => alias.startsWith(prefix)),
  );
  if (matches.length === 0) {
    return [paint(`  No command starts with ${line}. /help lists them all.`, "grey", colour)];
  }
  const max = Math.max(2, opts.maxRows ?? matches.length);
  const shown = matches.length > max ? matches.slice(0, max - 1) : matches;
  const lines = shown.map((item, i) => {
    const label = `/${item.name}${item.args ? ` ${item.args}` : ""}`.padEnd(24);
    return `  ${i === 0 ? paint(label, "brand", colour) : label} ${paint(item.help, "grey", colour)}`;
  });
  if (shown.length < matches.length) {
    lines.push(
      paint(
        `  … ${matches.length - shown.length} more. Keep typing to narrow the list.`,
        "grey",
        colour,
      ),
    );
  }
  return lines;
}
