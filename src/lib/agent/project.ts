import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

// Working out what kind of project this is, and where.
//
// Detection searches a couple of levels down rather than only at the root,
// because a monorepo with packages/api/package.json and packages/web/package.json
// and nothing meaningful at the top would otherwise report "no test framework
// found" while its tests sit one directory away.
//
// When several packages are found, the useful default is to act on whichever
// one contains the files that actually changed, rather than asking or running
// everything. That keeps the feedback loop tight and avoids a round trip.

export type Ecosystem = "npm" | "pip" | "cargo" | "go";

export interface Manifest {
  /** Directory holding the manifest, relative to the workspace root. "" is the root. */
  dir: string;
  ecosystem: Ecosystem;
  file: string;
  /** npm scripts, when there are any. */
  scripts: Record<string, string>;
}

/** Directories that are never the project. */
const SKIP = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".output",
  ".venv",
  "venv",
  "target",
  "vendor",
  "__pycache__",
  ".turbo",
  "coverage",
]);

const MANIFESTS: Array<{ file: string; ecosystem: Ecosystem }> = [
  { file: "package.json", ecosystem: "npm" },
  { file: "pyproject.toml", ecosystem: "pip" },
  { file: "requirements.txt", ecosystem: "pip" },
  { file: "Cargo.toml", ecosystem: "cargo" },
  { file: "go.mod", ecosystem: "go" },
];

/** How deep to look. Two levels covers packages/<name>/ and apps/<name>/,
 *  which is where monorepo layouts put things, without crawling the tree. */
const MAX_DEPTH = 2;

function readScripts(absolute: string): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(absolute, "utf8")) as {
      scripts?: Record<string, string>;
    };
    return parsed.scripts ?? {};
  } catch {
    // A malformed package.json is the project's problem to report, not a
    // reason for detection to throw.
    return {};
  }
}

export function detectManifests(root: string): Manifest[] {
  const found: Manifest[] = [];

  const scan = (dir: string, depth: number) => {
    for (const { file, ecosystem } of MANIFESTS) {
      const absolute = join(dir, file);
      if (!existsSync(absolute)) continue;
      found.push({
        dir: relative(root, dir).split(sep).join("/"),
        ecosystem,
        file,
        scripts: file === "package.json" ? readScripts(absolute) : {},
      });
    }
    if (depth >= MAX_DEPTH) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (SKIP.has(entry) || entry.startsWith(".")) continue;
      const child = join(dir, entry);
      try {
        if (statSync(child).isDirectory()) scan(child, depth + 1);
      } catch {
        /* unreadable entry */
      }
    }
  };

  scan(root, 0);
  return found;
}

/**
 * Which package a task concerns.
 *
 * The deepest manifest that contains a changed file wins: in a monorepo,
 * editing packages/api/src/x.ts should run the api package's tests, not the
 * whole workspace's. With no changed files, the root manifest is the answer.
 */
export function manifestForChanges(manifests: Manifest[], changedPaths: string[]): Manifest | null {
  if (manifests.length === 0) return null;
  const root = manifests.find((m) => m.dir === "") ?? null;
  if (changedPaths.length === 0) return root ?? manifests[0];

  let best: Manifest | null = null;
  for (const manifest of manifests) {
    const prefix = manifest.dir === "" ? "" : `${manifest.dir}/`;
    const owns = changedPaths.some((p) => p.startsWith(prefix));
    if (!owns) continue;
    // Deepest wins: a nested package is more specific than the root.
    if (!best || manifest.dir.length > best.dir.length) best = manifest;
  }
  return best ?? root ?? manifests[0];
}

/** The command that runs this package's tests, or null when it has none. A
 *  null is a real answer: "this project has no tests" is different from
 *  "the tests failed", and conflating them makes the agent invent test files. */
export function testCommand(manifest: Manifest): string | null {
  switch (manifest.ecosystem) {
    case "npm":
      return manifest.scripts.test ? "npm test" : null;
    case "pip":
      return "python -m pytest";
    case "cargo":
      return "cargo test";
    case "go":
      return "go test ./...";
  }
}

export function lintCommand(manifest: Manifest): string | null {
  switch (manifest.ecosystem) {
    case "npm": {
      if (manifest.scripts.lint) return "npm run lint";
      if (manifest.scripts.typecheck) return "npm run typecheck";
      return null;
    }
    case "cargo":
      return "cargo clippy";
    case "go":
      return "go vet ./...";
    default:
      return null;
  }
}

/** The real install command per ecosystem, honouring the project's own version
 *  convention rather than always reaching for latest. */
export function installCommand(
  ecosystem: Ecosystem,
  name: string,
  opts: { version?: string; dev?: boolean } = {},
): string {
  const version = opts.version?.trim();
  switch (ecosystem) {
    case "npm":
      return `npm install ${opts.dev ? "-D " : ""}${name}${version ? `@${version}` : ""}`;
    case "pip":
      return `pip install ${name}${version ? `==${version}` : ""}`;
    case "cargo":
      return `cargo add ${name}${version ? ` --vers ${version}` : ""}`;
    case "go":
      return `go get ${name}${version ? `@${version}` : ""}`;
  }
}

/** The manifest and lockfile an install touches, so the result can show what
 *  actually changed rather than just saying "success". */
export function lockfilesFor(manifest: Manifest): string[] {
  const dir = manifest.dir ? `${manifest.dir}/` : "";
  switch (manifest.ecosystem) {
    case "npm":
      return [
        `${dir}package.json`,
        `${dir}package-lock.json`,
        `${dir}bun.lock`,
        `${dir}yarn.lock`,
        `${dir}pnpm-lock.yaml`,
      ];
    case "pip":
      return [`${dir}requirements.txt`, `${dir}pyproject.toml`, `${dir}poetry.lock`];
    case "cargo":
      return [`${dir}Cargo.toml`, `${dir}Cargo.lock`];
    case "go":
      return [`${dir}go.mod`, `${dir}go.sum`];
  }
}

/** The directory a command for this manifest should run in. */
export function cwdFor(root: string, manifest: Manifest): string {
  return manifest.dir ? join(root, manifest.dir) : root;
}

export { dirname };
