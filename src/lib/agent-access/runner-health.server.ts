// Is the runner on the other end actually isolating what it runs?
//
// This exists because of a real gap found by comparing two /health responses.
// The deployed runner predated the sandbox, so its reply had no agentSandbox
// block at all, while the app happily sent it agent jobs: model-chosen shell
// commands executing on the runner host with no container around them. The
// code that refuses a job it cannot contain was written, tested, and sitting
// on a branch nobody had deployed.
//
// The app cannot fix a stale runner. What it can do is refuse to feed one,
// which turns "silently unsandboxed" into "explicitly unavailable, and here is
// why" -- the same choice the CLI makes when Docker is missing, for the same
// reason: somebody who believes they are sandboxed and is not is worse off
// than somebody who knows they are not.

export interface RunnerIsolation {
  ok: boolean;
  /** Said to the user when it is not ok. Names the fix, not the internals. */
  why: string;
}

/** Only the part of /health this cares about. Everything else the runner
 *  reports is somebody else's question, so the rest is left open rather than
 *  restated here and kept in step by hand. */
interface HealthBody {
  agentSandbox?: { enabled?: boolean; ready?: boolean; why?: string };
  [key: string]: unknown;
}

/** Checked once a minute rather than per request: this is a property of the
 *  deployment, it changes when somebody deploys, and a probe on every call
 *  would add a round trip to every build. */
const TTL_MS = 60_000;
let cached: { at: number; result: RunnerIsolation } | null = null;

/** For tests, and for a deploy that wants the next call to re-probe. */
export function forgetRunnerIsolation(): void {
  cached = null;
}

export function isolationFrom(body: HealthBody | null): RunnerIsolation {
  const sandbox = body?.agentSandbox;
  if (!sandbox) {
    // No such field: a runner older than the sandbox. This is the case that
    // was live in production.
    return {
      ok: false,
      why:
        "The build service is running a version without the agent sandbox, so it would run " +
        "the agent's commands unisolated. It needs redeploying before agent runs are accepted.",
    };
  }
  if (sandbox.enabled === false) {
    return {
      ok: false,
      why:
        "The build service has its agent sandbox switched off, so agent runs are not accepted. " +
        "Set DEVSTATION_SANDBOX on the runner, or allow unsandboxed runs deliberately.",
    };
  }
  if (!sandbox.ready) {
    return {
      ok: false,
      why: sandbox.why
        ? `The build service cannot isolate agent runs: ${sandbox.why}`
        : "The build service cannot isolate agent runs, so none are accepted.",
    };
  }
  return { ok: true, why: "" };
}

/**
 * Whether agent runs may be sent to the runner.
 *
 * ALLOW_UNSANDBOXED_RUNNER=1 is the deliberate way past this, for a local
 * runner with no Docker. It is an environment variable rather than a request
 * field on purpose: a caller must never be able to ask to be run unisolated.
 */
export async function runnerIsolation(url: string, token: string): Promise<RunnerIsolation> {
  if (process.env.ALLOW_UNSANDBOXED_RUNNER === "1") return { ok: true, why: "" };

  const now = Date.now();
  if (cached && now - cached.at < TTL_MS) return cached.result;

  const res = await fetch(`${url}/health`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);

  // Unreachable is a different failure, reported by the caller's own path. Not
  // cached, so a runner coming back up is picked up immediately.
  if (!res?.ok) return { ok: true, why: "" };

  const body = (await res.json().catch(() => null)) as HealthBody | null;
  const result = isolationFrom(body);
  cached = { at: now, result };
  return result;
}
