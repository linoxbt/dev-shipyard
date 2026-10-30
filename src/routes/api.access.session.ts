import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  CLAIM_COOKIE,
  claimCookieHeader,
  openClaims,
  readCookie,
  withOwner,
} from "@/lib/agent-access/claims.server";
import { accountAddress } from "@/lib/auth/account.server";
import { supabaseConfig, verifySupabaseToken } from "@/lib/auth/supabase.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// Email sign-in's way to DevStation's session (see lib/auth/supabase.server.ts).
//
// POST { accessToken }: Supabase confirms who the token belongs to; the reply
// sets the same httpOnly grant cookie a wallet signature used to, owned by the
// account's id. DELETE: signing out clears it.

const bodySchema = z.object({ accessToken: z.string().min(20).max(8192) });
const LIMIT = 30;
const WINDOW_MS = 10 * 60 * 1000;

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

export const Route = createFileRoute("/api/access/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!supabaseConfig()) {
          return fail("not_configured", "Email sign-in is not set up on this deployment.", 501);
        }
        if (
          !(await checkRateLimit(
            `access-session:${clientKeyFromRequest(request)}`,
            LIMIT,
            WINDOW_MS,
          ))
        ) {
          return fail("rate_limited", "Too many sign-in attempts. Wait a few minutes.", 429);
        }
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const account = await verifySupabaseToken(parsed.data.accessToken);
        if (!account) {
          return fail(
            "bad_session",
            "That sign-in could not be confirmed. Sign in again, and confirm your email if you have not.",
            401,
          );
        }
        const owner = accountAddress(account.email);
        // Keeps the workspaces this browser already holds.
        const existing = openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
        return new Response(JSON.stringify({ ok: true, owner }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": claimCookieHeader(
              withOwner(existing?.owner === owner ? existing : null, owner),
            ),
          },
        });
      },

      DELETE: () => {
        const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": `${CLAIM_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
          },
        });
      },
    },
  },
});
