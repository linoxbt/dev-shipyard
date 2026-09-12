import { flatten } from "../runner/checks";
import type { BenchTask } from "../runner/types";

// Reach outside the project for something, and then actually use it.
//
// Live-only, and deliberately so. Installing a package needs a network and a
// package registry; scripting it would leave a task that passes in CI while
// proving only that a MockProvider can emit the word "install". The free suite
// skips it and says so.
//
// It is also the only task that exercises the sandbox end to end: the shell
// has no network, so the agent has to know that install_dependency is the way
// through. An agent that has not been told, or has been told and ignores it,
// spends its budget on `npm install` failing to resolve a host.

export const installAndUse: BenchTask = {
  id: "install-and-use",
  title: "Add a dependency through the sealed wall, and use it",
  capability: "shell",
  goal:
    "src/ids.js needs to generate a short unique id. Use an existing package " +
    "from npm rather than writing your own generator, then make sure it works.",
  workspace: {
    "package.json": '{\n  "name": "bench-install",\n  "type": "module"\n}\n',
    "src/ids.js": `export function newId() {
  throw new Error("not implemented");
}
`,
    // The oracle. Restored from `before` before it is run, so editing it to
    // pass is not a way to pass. Deliberately agnostic about which package
    // gets chosen: the claim under test is that the dependency works, not that
    // the agent guessed a particular name.
    "verify.mjs": `import { newId } from "./src/ids.js";

const a = newId();
const b = newId();
if (typeof a !== "string") throw new Error("newId did not return a string");
if (a.length < 6) throw new Error("id is too short to be unique: " + a);
if (a === b) throw new Error("two ids were identical");
console.log("ok", a, b);
`,
  },
  maxSteps: 18,
  maxCostUsd: 0.75,

  // Installing a package is gated at medium risk, because an install runs the
  // package's own code. A task with no approver refuses everything, so the
  // first version of this asked the agent to install something and then said
  // no sixteen times. Approving exactly this one operation is also the more
  // interesting test: it shows the gate letting a specific thing through
  // rather than only ever blocking.
  approve: (request) => request.operation === "dependency.install",

  // No script: live only.

  checks: [
    {
      name: "it was told the shell has no network",
      kind: "custom",
      // Not applicable unsandboxed, which is a real way to run this suite.
      // Reporting a failure the agent did not cause teaches people to ignore
      // failures.
      run: (outcome) =>
        !outcome.sandbox || flatten(outcome.system).includes("the shell has no network access"),
    },
    {
      name: "it used the tool that has a network",
      kind: "tool.called",
      tool: "install_dependency",
    },
    {
      name: "it did not fight the wall with a shell",
      kind: "custom",
      // The addendum working, or not. An agent that keeps trying `npm install`
      // in a sealed shell is one that was not told, or was told and did not
      // believe it.
      run: (outcome) =>
        !outcome.toolCalls.some(
          (call) =>
            call.name === "run_shell" &&
            /\b(npm|yarn|pnpm|bun)\s+(i|add|install)\b/.test(String(call.input.command ?? "")),
        ),
    },
    {
      name: "the dependency is recorded in package.json",
      kind: "file.matches",
      path: "package.json",
      pattern: /"dependencies"\s*:\s*\{\s*"/,
    },
    { name: "the check itself was not edited", kind: "file.unchanged", path: "verify.mjs" },
    {
      name: "the approval was asked for and granted",
      kind: "event",
      event: "approval.granted",
    },
    {
      name: "the ids it generates are real",
      kind: "command",
      run: "node verify.mjs",
      expectExit: 0,
      restore: ["verify.mjs"],
    },
  ],
};
