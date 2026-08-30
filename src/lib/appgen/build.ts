import type { BuildOutcome } from "./session";

// Talking to the build runner from the browser.
//
// Everything goes through /api/build, never to the runner directly: its token
// grants the ability to run code on the runner host, so it stays on the
// server. This module's job is the translation either side of that call —
// workspace paths in, a BuildOutcome out — and making failure legible, because
// "the build failed" with nothing else is the problem this whole phase exists
// to remove.

/** Install, lint, build, then drive the built site in a real browser.
 *
 *  Typechecking is deliberately absent: generated projects are JavaScript, and
 *  `tsc --noEmit` against them reports nothing useful. */
export const DEFAULT_PHASES = ["install", "lint", "build", "test"] as const;

/** Whether this deployment has a runner at all. Cached: it cannot change
 *  without a redeploy, and the App Builder asks on every mount. */
let configured: Promise<boolean> | null = null;

export function buildConfigured(): Promise<boolean> {
  configured ??= fetch("/api/build")
    .then((r) => (r.ok ? (r.json() as Promise<{ configured?: boolean }>) : { configured: false }))
    .then((j) => j.configured === true)
    .catch(() => false);
  return configured;
}

/** Only for tests, which need to ask more than once. */
export function resetBuildConfigured(): void {
  configured = null;
}

/** Strip the workspace directory, so the runner sees a project root.
 *
 *  The workspace stores "app/package.json"; a build needs "package.json" at
 *  the top or npm has nothing to install and vite has nothing to build. */
export function projectFiles(files: Record<string, string>, dir = "app"): Record<string, string> {
  const prefix = dir ? `${dir}/` : "";
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    out[path.slice(prefix.length)] = content;
  }
  return out;
}

interface RunOptions {
  dir?: string;
  phases?: readonly string[];
  signal?: AbortSignal;
}

/** Run a job. Never throws: an unreachable runner is a fact about this
 *  deployment, not a defect in the app, and the caller has to be able to tell
 *  the difference. */
export async function runBuildJob(
  files: Record<string, string>,
  options: RunOptions = {},
): Promise<BuildOutcome> {
  const project = projectFiles(files, options.dir ?? "app");
  const unavailable = (message: string): BuildOutcome => ({
    ok: false,
    phases: [],
    dist: null,
    unavailable: message,
  });

  if (!project["package.json"]) {
    return unavailable("This app has no package.json, so there is nothing to build.");
  }

  try {
    const res = await fetch("/api/build", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        files: project,
        phases: options.phases ?? DEFAULT_PHASES,
      }),
      signal: options.signal,
    });
    const body = (await res.json().catch(() => null)) as
      | (Partial<BuildOutcome> & { message?: string; reason?: string })
      | null;

    if (!res.ok || !body) {
      return unavailable(body?.message ?? `The build service returned ${res.status}.`);
    }
    // A job that ran and failed is a real result with logs to learn from. A
    // job that never ran is not.
    if (!Array.isArray(body.phases) || body.phases.length === 0) {
      return unavailable(body.message ?? "The build did not run.");
    }
    return {
      ok: body.ok === true,
      phases: body.phases,
      dist: body.dist ?? null,
    };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return unavailable("The build was cancelled.");
    }
    return unavailable("Could not reach the build service.");
  }
}
