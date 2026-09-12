import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import {
  CLAIM_COOKIE,
  claimCookieHeader,
  holdsClaim,
  openClaims,
  ownerOf,
  readCookie,
  withClaim,
} from "@/lib/agent-access/claims.server";

// Starts and reads App Builder turns that outlive the page.
//
// A thin proxy in front of services/runner's /agent/jobs, for the same reason
// api.build.ts exists: the runner's token runs code on the runner host, so it
// stays server-side and the browser only ever talks to this route.
//
// The turn itself does NOT run here. This handler starts one and returns an id,
// or reads a job's current state, both of which finish in milliseconds. That
// matters because this app deploys to Netlify, where a function is killed after
// ten seconds; a build takes minutes. Polling short requests is what lets the
// same code work on a serverless host and survive a refresh.

const PER_IP_START_LIMIT = 20;
/** A person starts a handful of runs an hour, not hundreds. */
const PER_WALLET_START_LIMIT = 40;
const PER_IP_POLL_LIMIT = 2000;
const WINDOW_MS = 60 * 60 * 1000;

/** Same shape the publish route validates. A grant is bound to a person, so a
 *  wallet that is not an address is no wallet at all. */
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const startSchema = z.object({
  projectId: z.string().min(1).max(120),
  prompt: z.string().min(1).max(200_000),
  files: z.record(z.string(), z.string()).default({}),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
  context: z.unknown().optional(),
  dir: z.string().max(80).optional(),
  mode: z.enum(["build", "review"]).optional(),
  /** Deliberately NOT read from here any more. The owner is whatever wallet
   *  signed for the access grant in the cookie, because a field in a request
   *  body is whatever the caller typed. Accepted and ignored so an older page
   *  still posts successfully. */
  owner: z.string().regex(ADDRESS).optional(),
});

const answerSchema = z.object({
  id: z.string().min(1).max(200),
  requestId: z.string().min(1).max(200),
  /** Supplied by the browser, not generated here: idempotency only works if a
   *  retry carries the SAME id, and a value minted server-side would be new on
   *  every attempt. */
  clientRequestId: z.string().min(1).max(200),
  selectedOptionIds: z.array(z.string().max(80)).max(10).optional(),
  text: z.string().max(2_000).optional(),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

/**
 * Does this browser hold a claim on this job?
 *
 * Knowing an id used to be the whole of the authorisation. An agent id is
 * `agent-<timestamp>-<4 random bytes>`, so the secret part was 32 bits behind a
 * guessable prefix, and reading, cancelling or ANSWERING an approval prompt on
 * a stranger's run needed nothing else.
 */
function ownsJob(request: Request, id: string): boolean {
  return holdsClaim(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)), id);
}

const NOT_YOURS = ["not_yours", "That run was not started from this browser.", 403] as const;
const NO_GRANT = [
  "no_grant",
  "Connect a wallet and sign once to use the agent. It costs no gas.",
  401,
] as const;

// Read per request: some hosts bind env per request, where a module-level read
// is undefined.
function serverConfig() {
  const e = process.env;
  return {
    url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""),
    token: e.RUNNER_TOKEN ?? "",
  };
}

export const Route = createFileRoute("/api/agent")({
  server: {
    handlers: {
      // Either reports whether persistent turns are available, or returns one
      // job. Never says which variables are set.
      GET: async ({ request }) => {
        const cfg = serverConfig();
        const id = new URL(request.url).searchParams.get("id");
        if (!id) {
          return Response.json({ configured: cfg.url.length > 0 && cfg.token.length > 0 });
        }
        if (!cfg.url || !cfg.token)
          return fail("not_configured", "Builds are not configured.", 503);
        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`agent:poll:${ip}`, PER_IP_POLL_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many requests.", 429);
        }
        if (!/^agent-[a-z0-9-]+$/i.test(id)) return fail("bad_id", "Unknown job.", 400);
        if (!ownsJob(request, id)) return fail(...NOT_YOURS);
        const res = await fetch(`${cfg.url}/agent/jobs/${id}`, {
          headers: { authorization: `Bearer ${cfg.token}` },
        }).catch(() => null);
        if (!res) return fail("unreachable", "The build service is unreachable.", 502);
        const body = await res.text();
        return new Response(body, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },

      // Stop a running turn. The job keeps its record; only the work is halted.
      DELETE: async ({ request }) => {
        const cfg = serverConfig();
        if (!cfg.url || !cfg.token)
          return fail("not_configured", "Builds are not configured.", 503);
        const id = new URL(request.url).searchParams.get("id");
        if (!id || !/^agent-[a-z0-9-]+$/i.test(id)) return fail("bad_id", "Unknown job.", 400);
        if (!ownsJob(request, id)) return fail(...NOT_YOURS);
        if (
          !checkRateLimit(
            `agent:cancel:${clientKeyFromRequest(request)}`,
            PER_IP_START_LIMIT,
            WINDOW_MS,
          )
        ) {
          return fail("rate_limited", "Too many requests.", 429);
        }
        const res = await fetch(`${cfg.url}/agent/jobs/${id}/cancel`, {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.token}` },
        }).catch(() => null);
        if (!res) return fail("unreachable", "The build service is unreachable.", 502);
        return Response.json({ ok: res.ok });
      },

      // Answer the question a paused turn is waiting on.
      PATCH: async ({ request }) => {
        const cfg = serverConfig();
        if (!cfg.url || !cfg.token)
          return fail("not_configured", "Builds are not configured.", 503);
        const raw = await request.json().catch(() => null);
        const parsed = answerSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        if (!/^agent-[a-z0-9-]+$/i.test(parsed.data.id)) return fail("bad_id", "Unknown job.", 400);
        // The most important of the three. This answers a gated approval: a
        // third party holding an id could allow an action the owner never saw.
        if (!ownsJob(request, parsed.data.id)) return fail(...NOT_YOURS);

        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`agent:answer:${ip}`, PER_IP_START_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many requests.", 429);
        }

        const res = await fetch(`${cfg.url}/agent/jobs/${parsed.data.id}/decision`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.token}`,
          },
          body: JSON.stringify({
            requestId: parsed.data.requestId,
            clientRequestId: parsed.data.clientRequestId,
            selectedOptionIds: parsed.data.selectedOptionIds,
            text: parsed.data.text,
          }),
        }).catch(() => null);
        if (!res) return fail("unreachable", "The build service is unreachable.", 502);
        const body = await res.text();
        return new Response(body, {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },

      POST: async ({ request }) => {
        const cfg = serverConfig();
        if (!cfg.url || !cfg.token)
          return fail("not_configured", "Builds are not configured.", 503);
        // A run costs model credits and executes model-chosen commands on the
        // runner host, so it is not something an anonymous caller gets to
        // start. The grant is one signature, held in an httpOnly cookie: see
        // api.access.ts.
        const claims = openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
        const owner = ownerOf(claims);
        if (!owner) return fail(...NO_GRANT);

        const raw = await request.json().catch(() => null);
        const parsed = startSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);

        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`agent:start:${ip}`, PER_IP_START_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many builds from this client. Try again later.", 429);
        }

        // Per wallet as well as per IP. IPs are cheap; a wallet is not.
        if (
          !checkRateLimit(`agent:wallet:${owner.toLowerCase()}`, PER_WALLET_START_LIMIT, WINDOW_MS)
        ) {
          return fail("rate_limited", "Too many runs from this wallet. Try again later.", 429);
        }

        const res = await fetch(`${cfg.url}/agent/jobs`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${cfg.token}`,
            // Lets the runner rate-limit per caller rather than treating all of
            // DevStation as one bucket.
            "x-devstation-caller": ip,
            // Verified above by signature, not taken on trust from the body.
            // Before this, a caller could name any wallet and have grants
            // issued against it.
            "x-devstation-owner": owner,
          },
          body: JSON.stringify(parsed.data),
        }).catch(() => null);
        if (!res) return fail("unreachable", "The build service is unreachable.", 502);
        const body = await res.text();

        // Record which job this browser may touch from here on. Parsed rather
        // than assumed: a runner that refused the job hands back no id, and
        // claiming one that does not exist would be a lie in a cookie.
        const started = JSON.parse(body || "null") as { id?: string } | null;
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (res.ok && started?.id) {
          headers["set-cookie"] = claimCookieHeader(withClaim(claims, started.id, owner));
        }
        return new Response(body, { status: res.status, headers });
      },
    },
  },
});
