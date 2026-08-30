import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// Runs a generated project's real toolchain — install, lint, typecheck, build,
// Playwright — and returns the logs and the built output.
//
// A thin proxy in front of services/runner, and it exists for one reason: the
// runner's token must never reach a browser. Anyone holding it can run code on
// the runner host, so it stays server-side and the browser only ever talks to
// this route, which is rate limited.
//
// Builds are far more expensive than the other endpoints here — a job is a
// whole CPU and up to a gigabyte for a minute or more — so the limits are
// tighter than they look, and the global one exists so a single busy afternoon
// cannot saturate the runner for everybody.

const FILES_LIMIT = 200;
const TOTAL_BYTES_LIMIT = 2 * 1024 * 1024;
const PER_IP_LIMIT = 20;
const GLOBAL_LIMIT = 120;
const WINDOW_MS = 60 * 60 * 1000;
/** Longer than the runner's own job deadline, so its timeout wins and reports
 *  which phase died rather than this one failing with nothing to show. Tracks
 *  LIMITS.jobTimeoutMs in services/runner, which is 15 minutes since gVisor
 *  made every phase slower. */
const JOB_TIMEOUT_MS = 16 * 60 * 1000;

const PHASES = ["install", "lint", "typecheck", "build", "test"] as const;

const bodySchema = z.object({
  /** path -> file contents, relative to the project root. */
  files: z.record(z.string(), z.string()),
  phases: z.array(z.enum(PHASES)).min(1).max(PHASES.length).optional(),
  /** Directory to return after a successful build. */
  outDir: z.string().max(80).optional(),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

// Server-only, and read per request: some hosts bind env per request, where a
// module-level read is undefined.
function serverConfig() {
  const e = process.env;
  return {
    url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""),
    token: e.RUNNER_TOKEN ?? "",
  };
}

export const Route = createFileRoute("/api/build")({
  server: {
    handlers: {
      // Reports only whether builds are available, never which variables are
      // set. The App Builder uses this to decide between a real project and
      // the no-build fallback.
      GET: () => {
        const cfg = serverConfig();
        return Response.json({ configured: cfg.url.length > 0 && cfg.token.length > 0 });
      },

      POST: async ({ request }) => {
        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed build request.", 400);
        const { files, phases, outDir } = parsed.data;

        const paths = Object.keys(files);
        if (paths.length === 0) return fail("invalid_body", "No files to build.", 400);
        if (paths.length > FILES_LIMIT) {
          return fail("too_large", `A project may have at most ${FILES_LIMIT} files.`, 400);
        }
        const totalBytes = Object.values(files).reduce((n, c) => n + c.length, 0);
        if (totalBytes > TOTAL_BYTES_LIMIT) {
          return fail("too_large", "That project is larger than 2MB.", 400);
        }
        if (!paths.includes("package.json")) {
          return fail("invalid_body", "A build needs a package.json.", 400);
        }

        const ip = clientKeyFromRequest(request);
        if (
          !checkRateLimit(`build:ip:${ip}`, PER_IP_LIMIT, WINDOW_MS) ||
          !checkRateLimit("build:global", GLOBAL_LIMIT, WINDOW_MS)
        ) {
          return fail("rate_limited", "Too many builds. Try again later.", 429);
        }

        const cfg = serverConfig();
        if (!cfg.url || !cfg.token) {
          return fail(
            "not_configured",
            "Builds are not configured on this deployment. Generated apps still run without a build step.",
            501,
          );
        }

        try {
          const res = await fetch(`${cfg.url}/jobs`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${cfg.token}`,
              "content-type": "application/json",
              // The runner sees one token for the whole deployment, so it
              // cannot tell callers apart on its own. This is what lets it
              // rate limit per client rather than as one global bucket.
              "x-devstation-caller": ip,
            },
            body: JSON.stringify({ files, phases, outDir }),
            signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
          });
          const body = await res.json().catch(() => null);
          if (!res.ok) {
            const message =
              (body && typeof body === "object" && "message" in body
                ? String((body as { message: unknown }).message)
                : "") || `The build runner returned ${res.status}.`;
            return Response.json({ ok: false, reason: "runner_error", message }, { status: 502 });
          }
          return Response.json(body);
        } catch (e) {
          const timedOut = e instanceof Error && e.name === "TimeoutError";
          return fail(
            timedOut ? "timeout" : "runner_unreachable",
            timedOut
              ? "The build took too long and was stopped."
              : "Could not reach the build runner.",
            504,
          );
        }
      },
    },
  },
});
