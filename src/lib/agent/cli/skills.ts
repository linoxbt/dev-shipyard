import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Skills: instructions somebody wrote once and wants reused, kept as Markdown.
//
// A skill is `<name>.md` or `<name>/SKILL.md` in a skills folder. The project's
// folders are read before the user's, so a project can override a personal
// skill of the same name. `.claude/skills` is read too, so skills already
// written for Claude Code work here without being copied.

export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  scope: "project" | "user";
}

export function skillDirs(
  root: string,
  home = process.env.HOME ?? "",
): Array<[string, Skill["scope"]]> {
  const dirs: Array<[string, Skill["scope"]]> = [
    [join(root, ".devstation", "skills"), "project"],
    [join(root, ".claude", "skills"), "project"],
  ];
  if (home) {
    dirs.push([join(home, ".devstation", "skills"), "user"]);
    dirs.push([join(home, ".claude", "skills"), "user"]);
  }
  return dirs;
}

/** Splits `---` frontmatter from the body. Only flat `key: value` lines are
 *  read: name and description are all a skill needs. */
export function parseSkill(text: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };
  const meta: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const pair = /^([A-Za-z_-]+):\s*(.*)$/.exec(lines[index]);
    if (!pair) continue;
    let value = pair[2].trim();
    // YAML block scalars (`description: >` or `|`) continue on indented lines.
    if (/^[>|][+-]?$/.test(value)) {
      const parts: string[] = [];
      while (index + 1 < lines.length && /^\s+\S/.test(lines[index + 1])) {
        parts.push(lines[++index].trim());
      }
      value = parts.join(" ");
    }
    meta[pair[1].toLowerCase()] = value.replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(match[0].length).trim() };
}

function firstLine(body: string): string {
  const line = body.split("\n").find((l) => l.trim() && !l.trim().startsWith("#"));
  return (line ?? "").trim().slice(0, 100);
}

export function listSkills(root: string, home = process.env.HOME ?? ""): Skill[] {
  const found = new Map<string, Skill>();
  for (const [dir, scope] of skillDirs(root, home)) {
    if (!existsSync(dir)) continue;
    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      let path = join(dir, entry);
      let fallbackName = entry;
      try {
        if (statSync(path).isDirectory()) {
          path = join(path, "SKILL.md");
          if (!existsSync(path)) continue;
        } else if (entry.endsWith(".md")) {
          fallbackName = entry.slice(0, -".md".length);
        } else {
          continue;
        }
        const { meta, body } = parseSkill(readFileSync(path, "utf8"));
        const name = (meta.name || fallbackName).trim().toLowerCase().replace(/\s+/g, "-");
        if (!name || found.has(name)) continue;
        found.set(name, {
          name,
          description: meta.description || firstLine(body),
          body,
          path,
          scope,
        });
      } catch {
        // An unreadable skill is skipped, not fatal to the session.
      }
    }
  }
  return [...found.values()];
}

export function findSkill(root: string, name: string, home?: string): Skill | null {
  const wanted = name.trim().toLowerCase();
  return listSkills(root, home).find((skill) => skill.name === wanted) ?? null;
}

/** The turn a skill becomes: its instructions, then what it is to be used on. */
export function skillGoal(skill: Skill, task: string): string {
  return [
    `Use the "${skill.name}" skill. Its instructions:`,
    "",
    skill.body,
    "",
    task.trim() ? `Task: ${task.trim()}` : "Apply it to this project now.",
  ].join("\n");
}
