import { readMemory } from "../../src/lib/agent/memory/project-memory";
import type { BenchTask } from "../runner/types";

// Whether what the agent learns in one sitting reaches the next one.
//
// This is the only task with two sessions, and it needs them. Seeding
// PROJECT_MEMORY.md by hand would prove that a prompt can include a file
// somebody else wrote, which is not the claim. The claim is that the agent
// notices something worth keeping, writes it down, and that a later session
// with no knowledge of the first one behaves differently as a result.
//
// The workspace is deliberately ambiguous about where a setting belongs: there
// is a config file AND a module full of constants, and nothing in the code
// says which one is right. Without the memory, either answer is defensible.
// With it, only one is. That ambiguity is what makes the second session's
// behaviour evidence rather than coincidence.

const CONVENTION =
  "All tunable settings live in config/settings.json. " +
  "Never add a new constant to src/constants.js: it is being retired.";

export const memoryCarryover: BenchTask = {
  id: "memory-carryover",
  title: "Remember a convention, and apply it a session later",
  capability: "memory",
  goal: "Add a request timeout of 30 seconds.",
  workspace: {
    "package.json": '{ "name": "bench-memory", "type": "module" }\n',
    "config/settings.json": '{\n  "retries": 3,\n  "userAgent": "bench/1.0"\n}\n',
    "src/constants.js": `export const RETRIES = 3;\nexport const USER_AGENT = "bench/1.0";\n`,
    "src/client.js": `import { RETRIES } from "./constants.js";

export async function request(url) {
  for (let i = 0; i < RETRIES; i++) {
    const response = await fetch(url);
    if (response.ok) return response;
  }
  throw new Error("gave up");
}
`,
  },
  maxSteps: 12,

  // Session one. Told the convention, and expected to keep it: this is what a
  // person says once and never repeats.
  prior: {
    goal: `Note this for next time: ${CONVENTION}`,
    script: [
      {
        toolCalls: [{ id: "1", name: "remember", input: { note: CONVENTION, tag: "convention" } }],
      },
      { text: "Noted." },
    ],
  },

  // Session two. Nobody mentions the convention, and the goal could be met in
  // either place.
  script: [
    {
      toolCalls: [
        {
          id: "1",
          name: "write_file",
          input: {
            path: "config/settings.json",
            content: '{\n  "retries": 3,\n  "userAgent": "bench/1.0",\n  "timeoutMs": 30000\n}\n',
          },
        },
      ],
    },
    { text: "Added timeoutMs to config/settings.json, per the project convention." },
  ],

  checks: [
    {
      // The one that is actually about memory. Everything else below could be
      // satisfied by a lucky guess; this cannot.
      name: "session one's note reached session two's prompt",
      kind: "system.contains",
      text: "All tunable settings live in config/settings.json",
    },
    {
      name: "the note came from the agent, not from the fixture",
      kind: "custom",
      run: (outcome) => {
        // Proves the carryover is real rather than something the task seeded.
        // If PROJECT_MEMORY.md were in the workspace map, the check above
        // would pass while testing nothing at all.
        const entries = readMemory(outcome.root);
        return (
          entries.some((entry) => entry.note.includes("config/settings.json")) &&
          !("PROJECT_MEMORY.md" in outcome.before)
        );
      },
    },
    {
      name: "the setting went where the convention says",
      kind: "file.matches",
      path: "config/settings.json",
      pattern: /"timeoutMs"\s*:\s*30000/,
    },
    {
      name: "the retired file was left alone",
      kind: "file.unchanged",
      path: "src/constants.js",
    },
    {
      name: "nothing else was touched",
      kind: "files.changedOnly",
      paths: ["config/settings.json"],
    },
    { name: "it did not need to be told twice", kind: "steps.atMost", n: 12 },
  ],
};
