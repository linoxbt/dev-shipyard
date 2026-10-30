import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit } from "@/lib/rateLimit.server";
import { CLAIM_COOKIE, openClaims, ownerOf, readCookie } from "@/lib/agent-access/claims.server";
import { isRelayConfigured, relayAutoLabel } from "@/lib/label-relay.server";

// POST: label a contract the signed-in wallet deployed, as a trusted
// DevStation auto-label (see lib/label-relay.server.ts).
// GET ?chainId: whether auto-labels are available on that network.

const PER_WALLET_LIMIT = 30;
// Every label costs the labeler key gas, so total spend is capped too.
const GLOBAL_LIMIT = 300;
const WINDOW_MS = 60 * 60 * 1000;

const bodySchema = z.object({
  chainId: z.number().int().positive(),
  contractAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  name: z.string().trim().min(1).max(80),
  category: z.string().max(40).default(""),
  description: z.string().max(500).default(""),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

export const Route = createFileRoute("/api/label-relay")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const chainId = Number(new URL(request.url).searchParams.get("chainId"));
        return Response.json({ configured: isRelayConfigured(chainId) });
      },

      POST: async ({ request }) => {
        const owner = ownerOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!(await checkRateLimit(`label-relay:${owner}`, PER_WALLET_LIMIT, WINDOW_MS))) {
          return fail("rate_limited", "Too many labels. Try again later.", 429);
        }
        if (!(await checkRateLimit("label-relay:global", GLOBAL_LIMIT, WINDOW_MS))) {
          return fail("rate_limited", "Auto-labels are busy. Try again later.", 429);
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const result = await relayAutoLabel({
          ...parsed.data,
          contractAddress: parsed.data.contractAddress as `0x${string}`,
          owner,
        }).catch((e: unknown) => {
          // Details stay in the server log: RPC errors can name the
          // provider's URL or the labeler's address and balance.
          console.error("[label-relay]", e);
          return {
            ok: false,
            reason: "relay_failed",
            message: "The label could not be published.",
            status: 502,
          } as const;
        });
        if (!result.ok) return fail(result.reason, result.message, result.status);
        return Response.json({ ok: true, txHash: result.txHash });
      },
    },
  },
});
