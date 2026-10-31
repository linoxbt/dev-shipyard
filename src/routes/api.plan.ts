import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessOf } from "@/lib/db/access.server";
import { dbConfigured, insert, rpc } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// The signed-in account's plan and launch credit: read it, claim the $5
// launch credit (first 20 accounts), or ask for Pro.

const body = z.object({ action: z.enum(["claim", "request_pro"]) });

export const Route = createFileRoute("/api/plan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        try {
          return Response.json({ ok: true, access: await accessOf(owner), admin: isAdmin(owner) });
        } catch {
          return fail("db", "Your plan could not be read. Try again in a moment.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Plans are not set up yet.", 503);
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        if (!(await checkRateLimit(`plan:${clientKeyFromRequest(request)}`, 20, 10 * 60_000))) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        try {
          if (parsed.data.action === "claim") {
            const result = await rpc<{ ok: boolean; reason?: string }>("claim_launch_credit", {
              p_owner: owner,
            });
            if (!result.ok) {
              return fail(
                result.reason ?? "unavailable",
                result.reason === "already_claimed"
                  ? "You have already claimed your launch credit."
                  : "All 20 launch credits have been claimed.",
                409,
              );
            }
          } else {
            await insert(
              "account_plans",
              {
                owner,
                pro_requested_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { upsertOn: "owner" },
            );
          }
          return Response.json({ ok: true, access: await accessOf(owner) });
        } catch {
          return fail("db", "That did not go through. Try again in a moment.", 502);
        }
      },
    },
  },
});
