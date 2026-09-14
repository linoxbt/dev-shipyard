import type { GettingStartedStep } from "@/lib/data/marketplace/official";

// How a skill from the marketplace is installed and used. The same for every
// skill, official or bought: where its folder goes, and how the DevStation
// CLI, the web Coding Agent and Claude Code each pick it up.

export function skillInstallSteps(skillName: string): GettingStartedStep[] {
  return [
    {
      title: "Save the skill",
      body: `Download the ${skillName} folder and put it in your project's .devstation/skills folder, or in ~/.devstation/skills to use it in every project. Skills in .claude/skills are read too, so the same folder works for Claude Code.`,
      code: `mkdir -p .devstation/skills/${skillName}\n# put SKILL.md, and the files beside it, in that folder\nls .devstation/skills/${skillName}`,
    },
    {
      title: "Use it in the DevStation CLI",
      body: "Start a session in the project. /skill lists the skills it found. Run this one by name, followed by what you want done.",
      code: `devstation\n/skill\n/${skillName} <what you want done>`,
    },
    {
      title: "Use it in the web Coding Agent",
      body: "Upload the skill folder into your workspace with the folder button, then ask the agent to follow it.",
      code: `Follow .devstation/skills/${skillName}/SKILL.md to <what you want done>`,
    },
  ];
}

/** The skill folder a bundle's files live in: the directory holding SKILL.md. */
export function skillNameFromPaths(paths: readonly string[]): string | null {
  const skill = paths.find((path) => /(^|\/)SKILL\.md$/.test(path));
  if (!skill) return null;
  const parts = skill.split("/");
  return parts.length > 1 ? parts[parts.length - 2] : null;
}
