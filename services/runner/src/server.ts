// The runner's HTTP API.
//
// One job = one throwaway container. Files in, logs and build output back.
// See README.md for the threat model; the short version is that everything
// here assumes the code it is given is hostile.

import { createServer } from "node:http";
import { LIMITS, type PhaseName } from "./limits";
import { packTar, unpackTar } from "./tar";
import {
  MAX_QUEUED,
  RATE_LIMIT_GLOBAL,
  queueDepth,
  tokenMatches,
  withSlot,
  withinRateLimit,
} from "./gate";
import { dashboardPage, loginPage } from "./dashboard";
import { recordJob } from "./history";
import { snapshot } from "./stats";
import {
  COOKIE_NAME,
  LOGIN_ATTEMPTS,
  LOGIN_WINDOW_MS,
  clearedCookie,
  createSession,
  endSession,
  passwordMatches,
  readCookie,
  sessionCookie,
  validSession,
} from "./session";
import { cancelAgentJob, getAgentJob, startAgentJob, type StartAgentInput } from "./agent";
import { canServe, publishSite, serveFile, sitesFor, unpublishSite } from "./publish";
import {
  createContainer,
  destroyContainer,
  dockerAvailable,
  jobRuntime,
  runtimeAvailable,
  getDir,
  putFiles,
  runPhase,
  type PhaseResult,
} from "./sandbox";

const PORT = Number(process.env.PORT ?? 8792);
const HOST = process.env.RUNNER_HOST ?? "127.0.0.1";
/** Separate from RUNNER_TOKEN on purpose — see session.ts. Unset means the
 *  dashboard is off entirely rather than open. */
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD ?? "";
const TOKEN = process.env.RUNNER_TOKEN ?? "";
const IMAGE = process.env.RUNNER_IMAGE ?? "devstation-runner:3";
const DEFAULT_PHASES: PhaseName[] = ["install", "build"];
const VALID_PHASES = new Set<PhaseName>(["install", "lint", "typecheck", "build", "test"]);

interface JobBody {
  files?: Record<string, string>;
  phases?: PhaseName[];
  /** Directory to return after a successful build. */
  outDir?: string;
}

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

function html(res: import("node:http").ServerResponse, status: number, body: string) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    // The dashboard is one self-contained document: no external scripts,
    // styles, frames or fonts. Say so, so a stray injection cannot pull any in.
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; " +
      "connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

/** Read a bounded request body. Anything longer is truncated rather than
 *  buffered — a login form is a few dozen bytes. */
async function readBody(req: import("node:http").IncomingMessage, limit: number): Promise<string> {
  let out = "";
  for await (const chunk of req) {
    out += chunk;
    if (out.length > limit) break;
  }
  return out.slice(0, limit);
}

/** Per-client key for login rate limiting. Behind Caddy the socket address is
 *  always the proxy, so the forwarded header is what distinguishes callers;
 *  only the first hop is used, the rest is caller-controlled. */
function clientKey(req: import("node:http").IncomingMessage): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

/** Paths are attacker-controlled; keep them inside the workspace. */
function safePath(p: string): boolean {
  return (
    !p.startsWith("/") &&
    !p.includes("..") &&
    !p.includes("\0") &&
    p.length < 300 &&
    /^[A-Za-z0-9_\-./@]+$/.test(p)
  );
}

function validate(body: JobBody): string | null {
  const files = body.files ?? {};
  const names = Object.keys(files);
  if (names.length === 0) return "No files supplied.";
  if (names.length > LIMITS.maxFiles) return `At most ${LIMITS.maxFiles} files per job.`;
  let bytes = 0;
  for (const [p, c] of Object.entries(files)) {
    if (!safePath(p)) return `Unsafe path: ${p}`;
    bytes += c.length;
  }
  if (bytes > LIMITS.maxInputBytes) return "Project is too large.";
  for (const p of body.phases ?? []) {
    if (!VALID_PHASES.has(p)) return `Unknown phase: ${p}`;
  }
  return null;
}

const server = createServer(async (req, res) => {
  // No CORS headers at all, deliberately. Only DevStation's server calls this,
  // server-to-server, where CORS does not apply. Advertising "*" on an endpoint
  // that runs code invites a browser to try, and the answer is always no.
  if (req.method === "OPTIONS") return void res.writeHead(405).end();

  // --- Published apps -----------------------------------------------------
  //
  // Handled before anything else, and keyed on the Host header: a request for
  // <name>.devstation.online is a visitor looking at somebody's published app,
  // never an API call. Nothing below this point is reachable from a published
  // site's hostname, which is why this returns rather than falls through.
  const host = String(req.headers.host ?? "");
  if (canServe(host)) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return void res.writeHead(405).end();
    }
    const file = serveFile(host, req.url ?? "/");
    if (!file) return void res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    res.writeHead(200, {
      "content-type": file.contentType,
      "content-length": String(file.body.length),
      // User-published content: isolate it from DevStation itself and stop it
      // being sniffed into something else.
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "public, max-age=60",
    });
    return void res.end(req.method === "HEAD" ? undefined : file.body);
  }

  // Caddy asks this before requesting a certificate for an unknown host. It is
  // the only thing stopping anyone who points DNS at this box from making us
  // request certificates on their behalf, so it answers for real published
  // sites and nothing else. No auth: Caddy is on this host and cannot present a
  // bearer token, and the answer reveals only whether a name is taken.
  if ((req.url ?? "").startsWith("/tls-ask")) {
    const asked = new URL(req.url ?? "/", "http://localhost").searchParams.get("domain") ?? "";
    return void res.writeHead(canServe(asked) ? 200 : 403).end();
  }

  if (req.url === "/health") {
    return json(res, 200, {
      ok: true,
      docker: await dockerAvailable(),
      image: IMAGE,
      runtime: jobRuntime(),
      runtimeAvailable: await runtimeAvailable(),
      ...queueDepth(),
    });
  }

  // ---- Dashboard: a read-only view, gated by its own password ----------
  //
  // Everything below this block is the machine-to-machine API. These routes
  // are for a browser, and they can never reach POST /jobs: a dashboard
  // session is not a token, and the job route checks only for a token.
  const path = (req.url ?? "/").split("?")[0];
  const isDashRoute =
    path === "/" || path === "/login" || path === "/logout" || path === "/api/stats";

  if (isDashRoute) {
    if (!DASHBOARD_PASSWORD) {
      // Off, not open. A dashboard with no password would be a public window
      // into the machine.
      return html(res, 404, "Not found");
    }
    const signedIn = validSession(readCookie(req.headers.cookie, COOKIE_NAME));

    if (path === "/login" && req.method === "POST") {
      const ip = clientKey(req);
      if (!withinRateLimit(`login:${ip}`, LOGIN_ATTEMPTS, LOGIN_WINDOW_MS)) {
        return html(res, 429, loginPage("Too many attempts. Wait a few minutes."));
      }
      const body = await readBody(req, 4096);
      const given = new URLSearchParams(body).get("password") ?? "";
      if (!passwordMatches(given, DASHBOARD_PASSWORD)) {
        return html(res, 401, loginPage("That password is not right."));
      }
      res.writeHead(303, { location: "/", "set-cookie": sessionCookie(createSession()) });
      return void res.end();
    }

    if (path === "/logout" && req.method === "POST") {
      endSession(readCookie(req.headers.cookie, COOKIE_NAME));
      res.writeHead(303, { location: "/login", "set-cookie": clearedCookie() });
      return void res.end();
    }

    if (path === "/login") return html(res, 200, loginPage());

    if (!signedIn) {
      if (path === "/api/stats") return json(res, 401, { ok: false, message: "Sign in" });
      res.writeHead(303, { location: "/login" });
      return void res.end();
    }

    if (path === "/api/stats") {
      return json(
        res,
        200,
        await snapshot({
          image: IMAGE,
          runtime: jobRuntime(),
          runtimeAvailable: await runtimeAvailable(),
          docker: await dockerAvailable(),
        }),
      );
    }
    return html(res, 200, dashboardPage());
  }

  // --- App Builder turns -------------------------------------------------
  //
  // These outlive the page that started them, which is the entire point: the
  // browser holds an id, not a connection, so a refresh reattaches instead of
  // losing the build. Same bearer token as /jobs — starting a turn runs code.
  // --- Publish API --------------------------------------------------------
  //
  // Same bearer token as the rest: writing a site is a privileged operation,
  // and the owning wallet comes from DevStation's server, which has verified it.
  if (path.startsWith("/publish")) {
    if (!tokenMatches(req.headers.authorization, TOKEN)) {
      return json(res, 401, { ok: false, message: "Unauthorized" });
    }
    const owner = String(req.headers["x-devstation-owner"] ?? "").slice(0, 100);
    if (!/^0x[a-fA-F0-9]{40}$/.test(owner)) {
      return json(res, 400, { ok: false, message: "A wallet address is required to publish." });
    }

    if (req.method === "GET") {
      return json(res, 200, { ok: true, sites: sitesFor(owner) });
    }

    if (req.method === "POST" || req.method === "DELETE") {
      let raw = "";
      let tooBig = false;
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > LIMITS.maxInputBytes * 2) {
          tooBig = true;
          req.destroy();
        }
      });
      await new Promise((r) => req.on("end", r).on("close", r));
      if (tooBig) return json(res, 413, { ok: false, message: "Request too large" });
      let body: { slug?: string; files?: Record<string, string> };
      try {
        body = JSON.parse(raw || "{}") as typeof body;
      } catch {
        return json(res, 400, { ok: false, message: "Malformed JSON" });
      }
      if (req.method === "DELETE") {
        const gone = unpublishSite(String(body.slug ?? ""), owner);
        return json(res, gone ? 200 : 404, { ok: gone });
      }
      const caller =
        String(req.headers["x-devstation-caller"] ?? "").slice(0, 100) || clientKey(req);
      if (!withinRateLimit(`publish:${caller}`)) {
        return json(res, 429, { ok: false, message: "Too many publishes from this client." });
      }
      const result = publishSite({
        slug: String(body.slug ?? ""),
        files: body.files ?? {},
        owner,
      });
      return json(res, result.ok ? 200 : 400, result);
    }
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }

  if (path.startsWith("/agent/jobs")) {
    if (!tokenMatches(req.headers.authorization, TOKEN)) {
      return json(res, 401, { ok: false, message: "Unauthorized" });
    }
    const rest = path.slice("/agent/jobs".length).replace(/^\//, "");

    if (!rest && req.method === "POST") {
      const caller =
        String(req.headers["x-devstation-caller"] ?? "").slice(0, 100) || clientKey(req);
      if (!withinRateLimit(`agent:${caller}`)) {
        return json(res, 429, { ok: false, message: "Too many builds from this client." });
      }
      let raw = "";
      let tooBig = false;
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > LIMITS.maxInputBytes * 2) {
          tooBig = true;
          req.destroy();
        }
      });
      await new Promise((r) => req.on("end", r).on("close", r));
      if (tooBig) return json(res, 413, { ok: false, message: "Request too large" });
      let body: StartAgentInput & { files?: Record<string, string> };
      try {
        body = JSON.parse(raw) as StartAgentInput;
      } catch {
        return json(res, 400, { ok: false, message: "Malformed JSON" });
      }
      if (typeof body?.prompt !== "string" || !body.prompt.trim()) {
        return json(res, 400, { ok: false, message: "A prompt is required." });
      }
      if (typeof body?.projectId !== "string" || !body.projectId) {
        return json(res, 400, { ok: false, message: "A projectId is required." });
      }
      const job = startAgentJob({
        projectId: body.projectId,
        prompt: body.prompt,
        files: body.files ?? {},
        history: Array.isArray(body.history) ? body.history : [],
        context: body.context,
        dir: body.dir,
        mode: body.mode === "review" ? "review" : "build",
      });
      return json(res, 200, { ok: true, id: job.id, phase: job.phase, status: job.status });
    }

    if (rest.endsWith("/cancel") && req.method === "POST") {
      const cancelled = cancelAgentJob(rest.replace(/\/cancel$/, ""));
      return json(res, cancelled ? 200 : 404, { ok: cancelled });
    }

    if (rest && req.method === "GET") {
      const job = getAgentJob(rest);
      if (!job) return json(res, 404, { ok: false, message: "No such job." });
      return json(res, 200, { ok: true, job });
    }

    return json(res, 404, { ok: false, message: "Not found" });
  }

  if (path !== "/jobs" || req.method !== "POST") {
    return json(res, 404, { ok: false, message: "Not found" });
  }
  if (!tokenMatches(req.headers.authorization, TOKEN)) {
    return json(res, 401, { ok: false, message: "Unauthorized" });
  }
  // Per caller, not one global bucket. Keying every build under the literal
  // string "token" meant all of DevStation shared a single 30/hour budget, so
  // one busy user — or one abuser — starved everybody else. The caller is
  // identified by the header DevStation's proxy sets; the shared key remains as
  // a ceiling so the host itself cannot be swamped by many distinct callers.
  const caller = String(req.headers["x-devstation-caller"] ?? "").slice(0, 100) || clientKey(req);
  if (!withinRateLimit(`caller:${caller}`)) {
    return json(res, 429, { ok: false, message: "Too many builds from this client." });
  }
  if (!withinRateLimit("all", RATE_LIMIT_GLOBAL)) {
    return json(res, 429, { ok: false, message: "The build service is at capacity." });
  }

  let raw = "";
  let tooBig = false;
  req.on("data", (chunk) => {
    raw += chunk;
    if (raw.length > LIMITS.maxInputBytes * 2) {
      tooBig = true;
      req.destroy();
    }
  });
  await new Promise((r) => req.on("end", r).on("close", r));
  if (tooBig) return json(res, 413, { ok: false, message: "Request too large" });

  let body: JobBody;
  try {
    body = JSON.parse(raw) as JobBody;
  } catch {
    return json(res, 400, { ok: false, message: "Malformed JSON" });
  }
  const problem = validate(body);
  if (problem) return json(res, 400, { ok: false, message: problem });

  const phases = body.phases?.length ? body.phases : DEFAULT_PHASES;
  const name = `devstation-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const results: PhaseResult[] = [];

  // One job at a time. A build is a whole CPU and up to a gigabyte, and this
  // host has neither to spare twice over. Anything past the queue is turned
  // away now rather than holding a connection open for minutes.
  const outcome = await withSlot(async () => {
    // The clock starts when the job does, not when it was accepted: time spent
    // queueing is not the job's fault and should not eat its deadline.
    const startedAt = Date.now();
    const deadline = startedAt + LIMITS.jobTimeoutMs;
    let failure: string | undefined;
    let distCount: number | null = null;
    try {
      await createContainer(IMAGE, name);
      await putFiles(name, packTar(body.files!));

      for (const phase of phases) {
        if (Date.now() > deadline) {
          results.push({
            phase,
            ok: false,
            exitCode: null,
            log: "Job timed out before this phase ran.",
            durationMs: 0,
            timedOut: true,
          });
          break;
        }
        const result = await runPhase(name, phase);
        results.push(result);
        // Stop at the first failure: later phases would fail for the same
        // reason and the logs get harder to read, not easier.
        if (!result.ok) break;
      }

      let dist: Record<string, string> | null = null;
      const built = results.find((r) => r.phase === "build");
      if (built?.ok) {
        const tar = await getDir(name, body.outDir ?? "dist");
        if (tar) {
          dist = {};
          for (const entry of unpackTar(tar)) {
            // docker cp prefixes with the directory name.
            const rel = entry.path.replace(/^dist\//, "");
            if (!rel || rel.endsWith("/")) continue;
            dist[rel] = entry.content.toString("utf8");
          }
        }
      }

      distCount = dist ? Object.keys(dist).length : null;
      return {
        status: 200,
        body: { ok: results.every((r) => r.ok), phases: results, dist },
      };
    } catch (e) {
      failure = e instanceof Error ? e.message : "The job failed to start.";
      return {
        status: 500,
        body: { ok: false, phases: results, message: failure },
      };
    } finally {
      await destroyContainer(name);
      // Recorded whatever happened, including a job that never got going —
      // "it did not start" is exactly the kind of thing you want a record of.
      recordJob({
        id: name,
        startedAt,
        durationMs: Date.now() - startedAt,
        ok: failure === undefined && results.length > 0 && results.every((r) => r.ok),
        error: failure,
        fileCount: Object.keys(body.files ?? {}).length,
        distFileCount: distCount,
        phases: results.map((r) => ({
          phase: r.phase,
          ok: r.ok,
          durationMs: r.durationMs,
          timedOut: r.timedOut,
          log: r.log,
        })),
      });
    }
  });

  if (!outcome) {
    return json(res, 429, {
      ok: false,
      message: `The runner is busy — more than ${MAX_QUEUED} jobs are already waiting. Try again shortly.`,
    });
  }
  return json(res, outcome.status, outcome.body);
});

// Loopback by default, and deliberately.
//
// node's listen() with no host binds every interface, which on a VPS with no
// firewall means this is on the public internet — an endpoint that runs
// arbitrary code, guarded by one shared bearer token. That is not a default
// anyone should have to opt out of. Set RUNNER_HOST=0.0.0.0 only behind a
// reverse proxy that terminates TLS and does its own authentication.
server.listen(PORT, HOST, () => {
  console.log(
    `[runner] listening on ${HOST}:${PORT} image=${IMAGE} auth=${TOKEN ? "on" : "MISSING"}`,
  );
});
