import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { accessOf } from "@/lib/db/access.server";
import { usageState } from "@/lib/billing/limits.server";
import { dbConfigured, insert, rpc } from "@/lib/db/admin.server";
import { fail, isAdmin, personOf, requestEmail, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// The signed-in account's plan, launch credit and limits: read them, claim
// the launch credit (an amount for a number of accounts, set by an admin), or
// ask for Pro.

const body = z.object({ action: z.enum(["claim", "request_pro"]) });

export const Route = createFileRoute("/api/plan")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        try {
          const [access, today] = await Promise.all([
            accessOf(owner),
            // What today used, against the limits shown beside it.
            dbConfigured() ? usageState(owner, null).catch(() => null) : null,
          ]);
          return Response.json({
            ok: true,
            access: {
              ...access,
              today: today ? { spent: today.daySpent, runs: today.runsToday } : null,
            },
            admin: isAdmin(owner),
          });
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
          const email = requestEmail(request);
          if (!email) {
            // A session from before emails were carried: renewing it fixes this.
            return fail("no_grant", "Sign in again to continue.", 401);
          }
          if (parsed.data.action === "claim") {
            // One per person: plus-addressed or dotted variants of the same
            // Gmail inbox count as one.
            const result = await rpc<{ ok: boolean; reason?: string }>("claim_launch_credit_v2", {
              p_owner: owner,
              p_identity: personOf(email),
            });
            if (!result.ok) {
              return fail(
                result.reason ?? "unavailable",
                result.reason === "already_claimed"
                  ? "Launch credit has already been claimed for this email."
                  : "All 20 launch credits have been claimed.",
                409,
              );
            }
          } else {
            await insert(
              "account_plans",
              {
                owner,
                // So the request can be answered: the admin page lists it.
                contact: email,
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
