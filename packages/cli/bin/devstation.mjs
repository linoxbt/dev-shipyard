#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { targetFor } from "../scripts/target.mjs";

// What `devstation` runs when it was installed from npm.
//
// Three routes, in order of how well they work.
//
// The standalone binary, fetched at install time, carries its own runtime and
// needs nothing on the machine. That is the normal case.
//
// The bundled JavaScript through Bun, for anyone who installed with
// --ignore-scripts, or on a platform with no published binary. The project
// index is SQLite through `bun:sqlite`, which is why this route needs Bun
// rather than running on the node that just launched it.
//
// And if neither is available, a sentence saying which and what to do. A stack
// trace about a missing module is the same information, worse.

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const target = targetFor();
const binary = target ? join(here, "..", "scripts", target) : null;

if (binary && existsSync(binary)) {
  const run = spawnSync(binary, args, { stdio: "inherit" });
  process.exit(run.status ?? 1);
}

const bundle = join(here, "..", "devstation.js");
if (existsSync(bundle)) {
  const bun = spawnSync("bun", [bundle, ...args], { stdio: "inherit" });
  if (!(bun.error && bun.error.code === "ENOENT")) process.exit(bun.status ?? 1);
}

process.stderr.write(
  [
    "DevStation could not start: neither the standalone binary nor Bun is here.",
    "",
    target
      ? "  Reinstall to fetch the binary:  npm install -g @devstation/cli"
      : `  No prebuilt binary for ${process.platform}-${process.arch}.`,
    "  Or install Bun:                 curl -fsSL https://bun.sh/install | bash",
    "  Or take the binary directly:    https://github.com/linoxbt/dev-shipyard/releases/latest",
    "",
    "If your installer skips scripts (--ignore-scripts), the download above",
    "never ran. Either allow it, or use one of the other two routes.",
    "",
  ].join("\n"),
);
process.exit(127);
