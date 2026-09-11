#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The npm entry point.
//
// npm runs this with node, and the agent needs Bun: the project index is
// SQLite through `bun:sqlite`, which node has no equivalent of that ships with
// the runtime. So this hands off to Bun rather than pretending, and when Bun is
// not there it says so in one sentence with the two ways to fix it. A stack
// trace about a missing module is the same information, worse.

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "devstation.js");

if (!existsSync(bundle)) {
  process.stderr.write("This install is incomplete: devstation.js is missing.\n");
  process.exit(1);
}

const bun = spawnSync("bun", [bundle, ...process.argv.slice(2)], { stdio: "inherit" });

if (bun.error && bun.error.code === "ENOENT") {
  process.stderr.write(
    [
      "DevStation needs Bun, which is not on this machine.",
      "",
      "  Install Bun:        curl -fsSL https://bun.sh/install | bash",
      "  Or take the binary: curl -fsSL https://devstation.online/install.sh | sh",
      "",
      "The binary needs nothing installed at all; it carries its own runtime.",
      "",
    ].join("\n"),
  );
  process.exit(127);
}

process.exit(bun.status ?? 1);
