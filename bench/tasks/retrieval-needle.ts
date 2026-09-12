import type { BenchTask } from "../runner/types";

// Whether retrieval earns the context it spends.
//
// The answer sits somewhere nobody would guess, in a project too big to read
// file by file inside the step budget. Run with and without the index and the
// difference is the measurement; run only with it and all you learn is that
// the agent can read a file.

const files: Record<string, string> = {
  "package.json": '{ "name": "bench-needle", "type": "module" }\n',
  // The needle. Not in a file called rate-limit.ts, on purpose.
  "src/platform/quotas.js": `/** Requests a single client may make in an hour before it is throttled. */
export const HOURLY_REQUEST_CEILING = 240;

export function overQuota(count) {
  return count > HOURLY_REQUEST_CEILING;
}
`,
};
for (let i = 0; i < 60; i++) {
  files[`src/handlers/handler${i}.js`] =
    `export function handle${i}(request) {\n` +
    `  // Ordinary handler ${i}. Nothing about limits or quotas here.\n` +
    `  return { ok: true, handler: ${i} };\n}\n`;
}

export const retrievalNeedle: BenchTask = {
  id: "retrieval-needle",
  title: "Find one number in a project too big to read",
  capability: "retrieval",
  goal:
    "There is a cap on how many requests one client may make per hour. " +
    "Raise it to 500, changing only the file that defines it.",
  workspace: files,
  index: true,
  maxSteps: 10,

  script: [
    { toolCalls: [{ id: "1", name: "recall", input: { query: "hourly request cap per client" } }] },
    {
      toolCalls: [
        {
          id: "2",
          name: "edit_file",
          input: {
            path: "src/platform/quotas.js",
            patch:
              "@@ -1,3 +1,3 @@\n /** Requests a single client may make in an hour before it is throttled. */\n-export const HOURLY_REQUEST_CEILING = 240;\n+export const HOURLY_REQUEST_CEILING = 500;",
          },
        },
      ],
    },
    { text: "Raised the hourly ceiling to 500 in src/platform/quotas.js." },
  ],

  checks: [
    {
      name: "the right number changed",
      kind: "file.matches",
      path: "src/platform/quotas.js",
      pattern: /HOURLY_REQUEST_CEILING = 500/,
    },
    {
      name: "no handler was touched",
      kind: "files.changedOnly",
      paths: ["src/platform/quotas.js"],
    },
    { name: "it searched rather than guessed", kind: "tool.called", tool: "recall" },
    { name: "it found it quickly", kind: "steps.atMost", n: 10 },
  ],
};
