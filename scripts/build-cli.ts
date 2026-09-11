#!/usr/bin/env bun
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { VERSION } from "../src/lib/agent/cli/args";

// Building the CLI people install.
//
// Two shapes, because they solve different problems.
//
// A standalone binary per platform is the one that works with nothing
// installed: it embeds the Bun runtime, so somebody who has never heard of Bun
// can curl one file and run it. It costs about 95 MB, which is the runtime, not
// our code.
//
// A small JavaScript bundle is the one npm wants. It needs Bun on the machine,
// because the project index is SQLite through `bun:sqlite` and there is no
// Node equivalent that ships with the runtime. That is stated plainly by the
// shim rather than discovered as a stack trace.

const TARGETS = [
  { target: "bun-linux-x64", name: "devstation-linux-x64" },
  { target: "bun-linux-arm64", name: "devstation-linux-arm64" },
  { target: "bun-darwin-arm64", name: "devstation-darwin-arm64" },
  { target: "bun-darwin-x64", name: "devstation-darwin-x64" },
  { target: "bun-windows-x64", name: "devstation-windows-x64.exe" },
] as const;

const ENTRY = "src/lib/agent/cli/index.ts";

/** Where the release binaries go. Never the npm package: they are 90 MB each
 *  and npm is not a binary host. */
const RELEASE_DIR = process.env.CLI_OUT_DIR ?? "dist-cli";
/** Where the npm package's bundle goes, next to its hand-written shim. */
const PACKAGE_DIR = "packages/cli";

async function run(command: string[]): Promise<boolean> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) {
    process.stderr.write(await new Response(proc.stderr).text());
  }
  return code === 0;
}

function mb(path: string): string {
  return `${(statSync(path).size / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const args = process.argv.slice(2);
  const bundleOnly = args.includes("--bundle");
  const only = args.filter((a) => !a.startsWith("--"));
  const wanted =
    only.length > 0 ? TARGETS.filter((t) => only.some((o) => t.target.includes(o))) : TARGETS;

  // The npm bundle, written next to the package's own shim. Only the generated
  // file is replaced: an earlier version emptied the whole output directory,
  // which deleted the package.json and the bin shim the first time it was
  // pointed here. A build step that can eat hand-written files is not one to
  // leave lying around.
  mkdirSync(PACKAGE_DIR, { recursive: true });
  const bundle = join(PACKAGE_DIR, "devstation.js");
  rmSync(bundle, { force: true });
  if (!(await run(["bun", "build", ENTRY, "--target=bun", "--outfile", bundle]))) {
    throw new Error("Could not bundle the CLI.");
  }
  console.log(`bundle  ${bundle}  ${mb(bundle)}`);
  if (bundleOnly) return;

  // The release binaries, in their own directory, which this script owns
  // entirely and may therefore clear.
  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(join(RELEASE_DIR, "bin"), { recursive: true });

  const checksums: string[] = [];
  for (const { target, name } of wanted) {
    const out = join(RELEASE_DIR, "bin", name);
    process.stdout.write(`${target.padEnd(20)} `);
    if (
      !(await run([
        "bun",
        "build",
        "--compile",
        "--minify",
        `--target=${target}`,
        ENTRY,
        "--outfile",
        out,
      ]))
    ) {
      // A platform that will not build is reported and skipped, not fatal:
      // shipping four of five binaries beats shipping none.
      console.log("failed");
      continue;
    }
    const file = name.endsWith(".exe") ? out : out;
    const hash = createHash("sha256").update(readFileSync(file)).digest("hex");
    checksums.push(`${hash}  ${name}`);
    console.log(`${mb(file)}`);
  }

  writeFileSync(join(RELEASE_DIR, "SHA256SUMS"), `${checksums.join("\n")}\n`);
  writeFileSync(join(RELEASE_DIR, "VERSION"), `${VERSION}\n`);
  console.log(
    `\n${checksums.length} binaries in ${RELEASE_DIR}/bin, checksums in ${RELEASE_DIR}/SHA256SUMS`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
