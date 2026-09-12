import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyMessage } from "viem";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import {
  AGENT_AUTH_MESSAGE,
  agentStartMessage,
  issuedAtProblem,
} from "@/lib/agent-access/request-auth";
import {
  CLAIM_COOKIE,
  claimCookieHeader,
  openClaims,
  readCookie,
  withOwner,
} from "@/lib/agent-access/claims.server";

// One signature, once, for the endpoints that spend the operator's money.
//
// The alternative was a wallet prompt per request, which for a chat stream or
// a build-per-prompt loop is a prompt every few seconds. People learn to click
// through those without reading them, which is worse for security than asking
// once and meaning it.
//
// So: sign here, get an httpOnly cookie, and every cost-bearing route checks
// the cookie. The cookie carries the wallet, so a run's owner is a verified
// fact rather than a field the caller filled in.

const PER_IP_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const bodySchema = z.object({
  address: z.string().regex(ADDRESS),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  issuedAt: z.number().int().positive(),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

export const Route = createFileRoute("/api/access")({
  server: {
    handlers: {
      /** Whether this browser already holds a grant, so the UI can avoid
       *  asking for a signature it does not need. */
      GET: ({ request }) => {
        const claims = openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
        return Response.json({ ok: true, granted: !!claims, owner: claims?.owner ?? null });
      },

      POST: async ({ request }) => {
        if (!checkRateLimit(`access:${clientKeyFromRequest(request)}`, PER_IP_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many attempts. Try again later.", 429);
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);

        const { address, signature, issuedAt } = parsed.data;
        const timing = issuedAtProblem(issuedAt);
        if (timing) return fail(timing, AGENT_AUTH_MESSAGE[timing], 401);

        const valid = await verifyMessage({
          address: address as `0x${string}`,
          message: agentStartMessage({ address, issuedAt }),
          signature: signature as `0x${string}`,
        }).catch(() => false);
        if (!valid) return fail("bad_signature", AGENT_AUTH_MESSAGE.bad_signature, 401);

        // Keeps any job ids this browser already holds, so signing again after
        // an expiry does not orphan a run that is still going.
        const existing = openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
        return new Response(JSON.stringify({ ok: true, owner: address.toLowerCase() }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": claimCookieHeader(withOwner(existing, address.toLowerCase())),
          },
        });
      },
    },
  },
});
