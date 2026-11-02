import { createFileRoute } from "@tanstack/react-router";
import { accessOf } from "@/lib/db/access.server";
import { dbConfigured, rpc } from "@/lib/db/admin.server";
import { fail, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// The signed-in account's credit and usage (routes/credits.tsx): the balance
// and plan, and its model calls for the last 7, 30 or 90 days.

export const Route = createFileRoute("/api/credits")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Credits are not set up yet.", 503);
        if (!(await checkRateLimit(`credits:${owner}`, 120, 10 * 60_000))) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const asked = Number(new URL(request.url).searchParams.get("days"));
        const days = [7, 30, 90].includes(asked) ? asked : 30;
        try {
          const [access, usage] = await Promise.all([
            accessOf(owner),
            rpc<Record<string, unknown>>("account_usage", { p_owner: owner, p_days: days }),
          ]);
          return Response.json(
            { ok: true, access, usage },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return fail("db", "Your usage could not be read just now.", 502);
        }
      },
    },
  },
});
