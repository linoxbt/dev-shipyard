import type { BenchTask } from "../runner/types";

// Whether it patches surgically or rewrites wholesale.
//
// Directly sensitive to the diff instructions in system-prompt.ts, which is
// what makes it worth having: change that wording and this number moves.
// Rewriting a whole file to change one line is how an agent loses everything
// it forgot to re-emit.

const CONFIG = `/** Runtime configuration for the worker pool. */
export const config = {
  /** How many times a failed job is retried before it is parked. */
  retryCount: 3,
  backoffMs: 250,
  concurrency: 4,
};

/** True when the job has used up its retries. */
export function exhausted(attempts) {
  return attempts >= config.retryCount;
}

export function describe() {
  return \`retries=\${config.retryCount} concurrency=\${config.concurrency}\`;
}
`;

export const patchPrecision: BenchTask = {
  id: "patch-precision",
  title: "Rename a field everywhere without rewriting the file",
  capability: "edit",
  goal:
    "Rename the `retryCount` field to `maxRetries` everywhere in src/config.js, " +
    "including in the comment that mentions retries. Do not change anything else.",
  workspace: {
    "package.json": '{ "name": "bench-config", "type": "module" }\n',
    "src/config.js": CONFIG,
    "src/unrelated.js": "export const untouched = true;\n",
  },
  maxSteps: 10,

  script: [
    { toolCalls: [{ id: "1", name: "read_file", input: { path: "src/config.js" } }] },
    {
      toolCalls: [
        {
          id: "2",
          name: "write_file",
          input: { path: "src/config.js", content: CONFIG.replace(/retryCount/g, "maxRetries") },
        },
      ],
    },
    { text: "Renamed retryCount to maxRetries." },
  ],

  checks: [
    {
      name: "the rename happened",
      kind: "file.matches",
      path: "src/config.js",
      pattern: /maxRetries/,
    },
    {
      name: "no trace of the old name",
      kind: "custom",
      run: (o) => !(o.after["src/config.js"] ?? "").includes("retryCount"),
    },
    { name: "the file still parses", kind: "command", run: "node --check src/config.js" },
    { name: "nothing else was touched", kind: "files.changedOnly", paths: ["src/config.js"] },
    { name: "it did not wander", kind: "steps.atMost", n: 10 },
  ],
};
