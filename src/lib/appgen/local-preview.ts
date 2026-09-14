// What the browser can show of a project on its own, before any workspace
// exists.
//
// Mirrors the runner's previewPlan (services/runner/src/workspace-agent.ts):
// the root first, then a conventional front-end folder, and in each the first
// of a package.json with a build script (needs a build on the runner) or an
// index.html (served as it is). A cloned marketplace app is usually the second
// kind, so it can preview the moment it is opened.

const PREFERRED_DIRS = ["app", "web", "frontend", "client", "site", "www", "ui"];

export type LocalPreviewPlan =
  | { kind: "static"; dir: string }
  | { kind: "build"; dir: string }
  | { kind: "none" };

function hasBuildScript(raw: string): boolean {
  try {
    const pkg = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.build === "string" && pkg.scripts.build.length > 0;
  } catch {
    return false;
  }
}

export function localPreviewPlan(files: Record<string, string>): LocalPreviewPlan {
  const topDirs = new Set<string>();
  for (const path of Object.keys(files)) {
    const [first, ...rest] = path.split("/");
    if (rest.length === 1 && (rest[0] === "package.json" || rest[0] === "index.html")) {
      topDirs.add(first);
    }
  }
  const ordered = [
    "",
    ...PREFERRED_DIRS.filter((d) => topDirs.has(d)),
    ...[...topDirs].filter((d) => !PREFERRED_DIRS.includes(d)).sort(),
  ];
  for (const dir of ordered) {
    const prefix = dir ? `${dir}/` : "";
    const pkg = files[`${prefix}package.json`];
    if (pkg !== undefined && hasBuildScript(pkg)) return { kind: "build", dir };
    if (`${prefix}index.html` in files) return { kind: "static", dir };
  }
  return { kind: "none" };
}

/** The files inside `dir`, keyed relative to it: what gets published for a
 *  static app that lives in a folder. */
export function filesUnder(files: Record<string, string>, dir: string): Record<string, string> {
  if (!dir) return { ...files };
  const prefix = `${dir}/`;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(prefix)) out[path.slice(prefix.length)] = content;
  }
  return out;
}
