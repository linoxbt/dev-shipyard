import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { VERSION } from "./args";
import type { CommandContext, Terminal } from "./commands";

// Keeping the CLI current, the way `claude update` does.
//
// There was no way to upgrade except re-running whichever installer was used
// the first time, and nothing told anybody a newer version existed. Two pieces:
// an `upgrade` command that knows how it was installed and does the matching
// thing, and a one-line notice, at most once a day, that never puts a network
// request in front of the first prompt.

export const PACKAGE = "@devstationlabs/cli";
const REPO = "linoxbt/dev-shipyard";
const DAY_MS = 24 * 60 * 60 * 1000;

export type InstallMethod = "npm" | "binary" | "source";

/**
 * How this copy was installed, from where it is running.
 *
 * An npm install runs its platform binary from inside node_modules, or the
 * bundled JavaScript through Bun from there when scripts were skipped; either
 * way the path names the package. Bun running a .ts file is a source checkout.
 * Anything else is a standalone binary from the installer or a release.
 */
export function installMethod(
  execPath = process.execPath,
  script = process.argv[1] ?? "",
): InstallMethod {
  const slash = (p: string) => p.replace(/\\/g, "/");
  const marker = `node_modules/${PACKAGE}/`;
  if (slash(execPath).includes(marker) || slash(script).includes(marker)) return "npm";
  if (/\.(ts|tsx)$/.test(script) && /(^|\/)bun(\.exe)?$/.test(slash(execPath))) return "source";
  return "binary";
}

/** Numeric, dot by dot. A prerelease suffix is ignored rather than guessed at. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function latestVersion(
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<string | null> {
  try {
    const res = await fetchImpl(
      `https://registry.npmjs.org/${PACKAGE.replace("/", "%2f")}/latest`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/** Mirrors packages/cli/scripts/target.mjs. Kept in step by name: a mismatch
 *  would download a file the release does not have, and the checksum lookup
 *  fails loudly before anything is replaced. */
export function targetFor(platform = process.platform, arch = process.arch): string | null {
  const map: Record<string, string> = {
    "linux-x64": "devstation-linux-x64",
    "linux-arm64": "devstation-linux-arm64",
    "darwin-arm64": "devstation-darwin-arm64",
    "darwin-x64": "devstation-darwin-x64",
    "win32-x64": "devstation-windows-x64.exe",
  };
  return map[`${platform}-${arch}`] ?? null;
}

function runInherit(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.error) return 127;
  return result.status ?? 1;
}

export interface UpgradeOptions {
  check?: boolean;
  fetchImpl?: typeof fetch;
  execPath?: string;
  script?: string;
  run?: (command: string, args: string[]) => number;
}

export async function upgradeCommand(
  context: CommandContext,
  opts: UpgradeOptions = {},
): Promise<number> {
  const t = context.terminal;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const latest = await latestVersion(fetchImpl);
  if (!latest) {
    t.err("Could not reach the npm registry to check for a newer version. Nothing was changed.");
    return 1;
  }
  if (compareVersions(latest, VERSION) <= 0) {
    t.out(`devstation ${VERSION} is the latest version.`);
    return 0;
  }

  t.out(`devstation ${latest} is available (you have ${VERSION}).`);
  const method = installMethod(opts.execPath, opts.script);
  if (opts.check) {
    t.out(
      method === "source"
        ? "This is a source checkout: update it with git pull."
        : "Upgrade with: devstation upgrade",
    );
    return 0;
  }

  switch (method) {
    case "npm": {
      t.out(`Installed through npm, so upgrading through npm: npm install -g ${PACKAGE}@${latest}`);
      const code = (opts.run ?? runInherit)("npm", [
        "install",
        "-g",
        `${PACKAGE}@${latest}`,
        // npm answers from its cached package list for a while after a
        // release, and then reports the version it was just told about as
        // not existing (ETARGET).
        "--prefer-online",
      ]);
      if (code !== 0) {
        t.err(
          `npm exited with ${code}. Nothing else was changed. Run it yourself: npm install -g ${PACKAGE}@latest`,
        );
        return code === 0 ? 1 : code;
      }
      t.out(`Upgraded to ${latest}. If your shell still runs the old one, run: hash -r`);
      return 0;
    }
    case "source":
      t.out("This is running from a source checkout. Update it with git pull, not upgrade.");
      return 0;
    case "binary":
      return replaceBinary(t, latest, opts.execPath ?? process.execPath, fetchImpl);
  }
}

/**
 * Replace a standalone binary with the new release's, verified first.
 *
 * Same rule as both installers: checksums are fetched before the binary, and
 * nothing is written unless the download matches. The new file is written
 * beside the old one and renamed over it, so an interrupted upgrade leaves the
 * working version in place rather than half of a new one. Renaming over a
 * running executable is fine on Linux and macOS; Windows will not allow it.
 */
async function replaceBinary(
  t: Terminal,
  latest: string,
  execPath: string,
  fetchImpl: typeof fetch,
): Promise<number> {
  const target = targetFor();
  if (!target) {
    t.err(`There is no prebuilt binary for ${process.platform}-${process.arch}.`);
    return 1;
  }
  if (process.platform === "win32") {
    t.err(
      `A running .exe cannot replace itself on Windows. Download ${target} from https://github.com/${REPO}/releases/latest and swap it in.`,
    );
    return 1;
  }

  const base = `https://github.com/${REPO}/releases/download/v${latest}`;
  t.out(`Downloading ${target} ${latest}…`);
  try {
    const sums = await fetchImpl(`${base}/SHA256SUMS`, { redirect: "follow" });
    if (!sums.ok) throw new Error(`${sums.status} fetching the checksums`);
    const expected = (await sums.text())
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === target)?.[0];
    if (!expected) throw new Error(`no checksum is published for ${target}`);

    const bin = await fetchImpl(`${base}/${target}`, { redirect: "follow" });
    if (!bin.ok) throw new Error(`${bin.status} downloading ${target}`);
    const body = Buffer.from(await bin.arrayBuffer());
    const actual = createHash("sha256").update(body).digest("hex");
    if (actual !== expected) {
      throw new Error(
        `the download does not match its checksum (expected ${expected}, got ${actual})`,
      );
    }

    const partial = `${execPath}.partial`;
    writeFileSync(partial, body);
    chmodSync(partial, 0o755);
    renameSync(partial, execPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const permission = /EACCES|EPERM/.test(message)
      ? " Run it with sudo, since the binary is in a system directory."
      : "";
    t.err(`Upgrade failed and the installed version was left untouched: ${message}.${permission}`);
    return 1;
  }

  t.out(`Upgraded ${execPath} to ${latest}.`);
  return 0;
}

export interface NoticeOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  now?: number;
  fetchImpl?: typeof fetch;
}

/**
 * One line when a newer version exists, at most one registry request a day.
 *
 * The line comes from a cached answer, so it costs a file read. The cache is
 * refreshed in the background when it is more than a day old, so the answer is
 * at most a day stale and the network is never in front of the first prompt.
 * Off in CI and with DEVSTATION_NO_UPDATE_CHECK=1: a pipeline has no use for it
 * and should not be making requests nobody asked for.
 */
export function notifyIfOutdated(terminal: Terminal, opts: NoticeOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;
  if (env.DEVSTATION_NO_UPDATE_CHECK === "1" || env.CI) return Promise.resolve();
  const homeDir = opts.home ?? env.HOME ?? "";
  if (!homeDir) return Promise.resolve();

  const path = join(homeDir, ".devstation", "update-check.json");
  let cached: { checkedAt?: number; latest?: string } = {};
  try {
    cached = JSON.parse(readFileSync(path, "utf8")) as typeof cached;
  } catch {
    // No cache yet, or a broken one: treated as never checked.
  }

  if (cached.latest && compareVersions(cached.latest, VERSION) > 0) {
    terminal.err(
      `devstation ${cached.latest} is available (you have ${VERSION}). Run: devstation upgrade`,
    );
  }

  const now = opts.now ?? Date.now();
  if (cached.checkedAt && now - cached.checkedAt < DAY_MS) return Promise.resolve();

  return latestVersion(opts.fetchImpl ?? fetch, 2500).then((latest) => {
    if (!latest) return;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      writeFileSync(path, `${JSON.stringify({ checkedAt: now, latest })}\n`);
    } catch {
      // A read-only home is not a reason to interrupt anything.
    }
  });
}
