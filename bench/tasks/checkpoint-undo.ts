import type { BenchTask } from "../runner/types";
import { undoCheckpoint } from "../../src/lib/agent/git";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The recovery path, which nothing else in the suite covers.
//
// It matters more than it looks: the sandbox deliberately does not protect the
// workspace, and checkpoints plus undo are what does. If undo quietly stops
// working, the thing people were relying on is gone and nothing says so.

const ORIGINAL = "export const greeting = 'hello';\n";

export const checkpointUndo: BenchTask = {
  id: "checkpoint-undo",
  title: "Checkpoint an edit, and undo it cleanly",
  capability: "git",
  goal: "Change the greeting in src/greet.js from 'hello' to 'good morning'.",
  git: true,
  workspace: {
    "package.json": '{ "name": "bench-greet", "type": "module" }\n',
    "src/greet.js": ORIGINAL,
  },
  maxSteps: 8,

  script: [
    {
      toolCalls: [
        {
          id: "1",
          name: "write_file",
          input: { path: "src/greet.js", content: "export const greeting = 'good morning';\n" },
        },
      ],
    },
    { text: "Changed the greeting." },
  ],

  checks: [
    {
      name: "the edit landed",
      kind: "file.matches",
      path: "src/greet.js",
      pattern: /good morning/,
    },
    { name: "a checkpoint was made", kind: "event", event: "checkpoint" },
    {
      name: "exactly one agent checkpoint in the history",
      kind: "command",
      run: "test \"$(git log --oneline --grep='agent checkpoint:' | wc -l)\" -eq 1",
    },
    {
      name: "undo puts the file back byte for byte",
      kind: "custom",
      run: async (outcome) => {
        const undone = await undoCheckpoint(outcome.root);
        if (!undone.ok) return false;
        return readFileSync(join(outcome.root, "src/greet.js"), "utf8") === ORIGINAL;
      },
    },
  ],
};
