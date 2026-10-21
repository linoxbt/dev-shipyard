import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyMessage } from "viem";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import { ownOrigin } from "@/lib/http-guard.server";
import {
  AGENT_AUTH_MESSAGE,
  AGENT_SIG_TTL_MS,
  accessMessage,
  issuedAtProblem,
} from "@/lib/agent-access/request-auth";
import {
  CLAIM_COOKIE,
  NONCE_COOKIE,
  claimCookieHeader,
  issueNonce,
  nonceCookieHeader,
  openClaims,
  openNonce,
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
// So: fetch a nonce (GET ?nonce), sign an EIP-4361 message that names this
// domain and carries that nonce, get an httpOnly cookie, and every cost-bearing
// route checks the cookie. The cookie carries the wallet, so a run's owner is a
// verified fact rather than a field the caller filled in.

const PER_IP_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;
const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const bodySchema = z.object({
  address: z.string().regex(ADDRESS),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  issuedAt: z.number().int().positive(),
  chainId: z
    .number()
    .int()
    .positive()
    .max(2 ** 53),
});

function fail(reason: string, message: string, status: number, extraCookie?: string) {
  const headers: [string, string][] = [["content-type", "application/json"]];
  if (extraCookie) headers.push(["set-cookie", extraCookie]);
  return new Response(JSON.stringify({ ok: false, reason, message }), { status, headers });
}

export const Route = createFileRoute("/api/access")({
  server: {
    handlers: {
      /** Whether this browser already holds a grant, so the UI can avoid
       *  asking for a signature it does not need. With ?nonce, also issues the
       *  single-use nonce the next signature must carry. */
      GET: ({ request }) => {
        const claims = openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
        const body: Record<string, unknown> = {
          ok: true,
          granted: !!claims,
          owner: claims?.owner ?? null,
        };
        if (!new URL(request.url).searchParams.has("nonce")) return Response.json(body);
        const { nonce, sealed } = issueNonce();
        return new Response(JSON.stringify({ ...body, nonce }), {
          headers: [
            ["content-type", "application/json"],
            ["cache-control", "no-store"],
            ["set-cookie", nonceCookieHeader(sealed)],
          ],
        });
      },

      POST: async ({ request }) => {
        if (
          !(await checkRateLimit(
            `access:${clientKeyFromRequest(request)}`,
            PER_IP_LIMIT,
            WINDOW_MS,
          ))
        ) {
          return fail("rate_limited", "Too many attempts. Try again later.", 429);
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);

        const cookies = request.headers.get("cookie");
        const cleared = nonceCookieHeader(null);
        const nonce = openNonce(readCookie(cookies, NONCE_COOKIE));
        if (!nonce) return fail("bad_nonce", AGENT_AUTH_MESSAGE.bad_nonce, 401, cleared);

        const { address, signature, issuedAt, chainId } = parsed.data;
        const timing = issuedAtProblem(issuedAt);
        if (timing) return fail(timing, AGENT_AUTH_MESSAGE[timing], 401, cleared);

        const origin = ownOrigin(request);
        if (!origin) return fail("invalid_body", "Malformed request.", 400, cleared);
        const valid = await verifyMessage({
          address: address as `0x${string}`,
          message: accessMessage({
            domain: new URL(origin).host,
            uri: origin,
            address,
            chainId,
            nonce,
            issuedAt,
          }),
          signature: signature as `0x${string}`,
        }).catch(() => false);
        if (!valid) return fail("bad_signature", AGENT_AUTH_MESSAGE.bad_signature, 401, cleared);

        // Single use: clearing the cookie stops this browser re-sending it,
        // and this refuses the same nonce if it is presented again while live
        // (shared across instances when the rate-limit store is configured).
        if (!(await checkRateLimit(`access-nonce:${nonce}`, 1, AGENT_SIG_TTL_MS * 2))) {
          return fail("bad_nonce", AGENT_AUTH_MESSAGE.bad_nonce, 401, cleared);
        }

        // Keeps any job ids this browser already holds, so signing again after
        // an expiry does not orphan a run that is still going.
        const existing = openClaims(readCookie(cookies, CLAIM_COOKIE));
        return new Response(JSON.stringify({ ok: true, owner: address.toLowerCase() }), {
          status: 200,
          headers: [
            ["content-type", "application/json"],
            ["set-cookie", claimCookieHeader(withOwner(existing, address.toLowerCase()))],
            ["set-cookie", cleared],
          ],
        });
      },
    },
  },
});
