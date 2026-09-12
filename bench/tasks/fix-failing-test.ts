import type { BenchTask } from "../runner/types";

// The baseline task, and the one that has to be first.
//
// "Make the tests pass" is trivially satisfied by deleting the test, and a
// suite that does not check for that will reward an agent for doing it. So the
// oracle restores the test file from the starting workspace before running it,
// and the task also asserts the test file was never touched in the first place.

const SOURCE = `export function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}
`;

const TEST = `import { expect, it } from "bun:test";
import { total } from "./total.js";

it("adds up prices", () => {
  expect(total([{ price: 2 }, { price: 3 }])).toBe(5);
});

it("applies each item's quantity", () => {
  expect(total([{ price: 2, quantity: 3 }])).toBe(6);
});
`;

const FIXED = SOURCE.replace("sum += item.price;", "sum += item.price * (item.quantity ?? 1);");

export const fixFailingTest: BenchTask = {
  id: "fix-failing-test",
  title: "Fix the source so a failing test passes",
  capability: "edit",
  goal:
    "One test in src/total.test.js is failing. Find out why and fix the source, " +
    "not the test. Then run the tests.",
  workspace: {
    "package.json":
      '{ "name": "bench-total", "type": "module", "scripts": { "test": "bun test" } }\n',
    "src/total.js": SOURCE,
    "src/total.test.js": TEST,
  },
  maxSteps: 12,

  script: [
    { toolCalls: [{ id: "1", name: "read_file", input: { path: "src/total.test.js" } }] },
    { toolCalls: [{ id: "2", name: "read_file", input: { path: "src/total.js" } }] },
    {
      toolCalls: [
        {
          id: "3",
          name: "edit_file",
          input: {
            path: "src/total.js",
            patch:
              "@@ -1,6 +1,6 @@\n export function total(items) {\n   let sum = 0;\n   for (const item of items) {\n-    sum += item.price;\n+    sum += item.price * (item.quantity ?? 1);\n   }\n   return sum;",
          },
        },
      ],
    },
    { toolCalls: [{ id: "4", name: "run_tests", input: {} }] },
    { text: "total() now multiplies price by quantity, defaulting to 1. Both tests pass." },
  ],

  checks: [
    {
      name: "the tests pass against the ORIGINAL test file",
      kind: "command",
      run: "bun test",
      restore: ["src/total.test.js"],
    },
    {
      name: "the source was actually fixed",
      kind: "file.matches",
      path: "src/total.js",
      pattern: /quantity/,
    },
    { name: "the test file was left alone", kind: "file.unchanged", path: "src/total.test.js" },
    { name: "nothing else was touched", kind: "files.changedOnly", paths: ["src/total.js"] },
    { name: "it ran the tests", kind: "tool.called", tool: "run_tests" },
    { name: "it did not wander", kind: "steps.atMost", n: 12 },
  ],
};

export { FIXED };
