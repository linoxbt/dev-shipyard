// Bundles the agent server (services/runner) into one file for Vercel Sandbox.
//
// Each project's agent runs in a sandbox of its own, and the website starts it
// there from this bundle (src/lib/orchestrator/sandbox.server.ts). Run before
// `vite build`, which imports the result as text:
//
//   bun scripts/build-agent-server.ts

import { join } from "node:path";

const root = join(import.meta.dir, "..");
const out = join(root, "src/lib/orchestrator/agent-server.gen.mjs");

const result = await Bun.build({
  entrypoints: [join(root, "services/runner/src/server.ts")],
  // The server uses bun:sqlite, so it runs on Bun inside the sandbox.
  target: "bun",
  format: "esm",
  minify: true,
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const code = await result.outputs[0].text();
await Bun.write(out, code);
console.log(`agent server: ${(code.length / 1024).toFixed(0)} KB -> ${out}`);
