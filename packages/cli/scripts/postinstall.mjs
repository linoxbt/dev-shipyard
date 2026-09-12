#!/usr/bin/env node
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { targetFor } from "./target.mjs";

// Fetch the standalone binary for this machine, once, at install time.
//
// The alternative was what this package used to do: ship JavaScript and shell
// out to Bun, because the project index is SQLite through `bun:sqlite`. That
// made "npm install -g" work only on machines that already had Bun, which is
// not what installing a CLI from npm is supposed to mean.
//
// Publishing five ~90MB platform packages as optionalDependencies -- the
// esbuild approach, and the better one when the binaries are small -- would put
// nearly half a gigabyte on the registry for every release. So this downloads
// the one binary this machine needs from the GitHub release that matches the
// package version, and verifies it against the published SHA256SUMS before
// putting it anywhere. An unverified binary is not installed at all.
//
// If it cannot run, it does not fail the install: `npm i` failing on a network
// blip is worse than a clear message the first time you run the command. The
// launcher says exactly what happened and how to fix it by hand.

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const require = createRequire(import.meta.url);
const { version } = require(join(root, "package.json"));

const REPO = process.env.DEVSTATION_REPO ?? "linoxbt/dev-shipyard";
const TAG = process.env.DEVSTATION_VERSION ?? `v${version}`;
const BASE = `https://github.com/${REPO}/releases/download/${TAG}`;

function note(message) {
  process.stderr.write(`devstation: ${message}\n`);
}

async function get(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res;
}

async function main() {
  if (process.env.DEVSTATION_SKIP_DOWNLOAD === "1") return;

  const target = targetFor();
  if (!target) {
    note(
      `no prebuilt binary for ${process.platform}-${process.arch}. ` +
        "The command will fall back to Bun if you have it.",
    );
    return;
  }

  const destination = join(here, target);
  if (existsSync(destination)) return;

  // Checksums first: a binary that arrives before anything can vouch for it is
  // a binary that gets run before anything can vouch for it.
  const sums = await (await get(`${BASE}/SHA256SUMS`)).text();
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === target)?.[0];
  if (!expected) throw new Error(`no checksum published for ${target} in ${TAG}`);

  const body = Buffer.from(await (await get(`${BASE}/${target}`)).arrayBuffer());
  const actual = createHash("sha256").update(body).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `checksum mismatch for ${target}\n  expected: ${expected}\n  actual:   ${actual}`,
    );
  }

  // Written beside the target and renamed, so an interrupted install cannot
  // leave a half-written binary that looks complete.
  mkdirSync(here, { recursive: true });
  const partial = `${destination}.partial`;
  writeFileSync(partial, body);
  chmodSync(partial, 0o755);
  renameSync(partial, destination);
  try {
    unlinkSync(`${destination}.partial`);
  } catch {
    // Already renamed away; nothing to clean up.
  }
}

main().catch((error) => {
  note(
    `could not install the binary (${error instanceof Error ? error.message : error}).\n` +
      "  The command will explain what to do when you run it. Nothing is broken yet.",
  );
  // Deliberately not a failed install.
});
