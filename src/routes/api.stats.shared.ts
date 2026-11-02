import { createFileRoute } from "@tanstack/react-router";
import { dbConfigured } from "@/lib/db/admin.server";
import { fail } from "@/lib/db/request.server";
import {
  countView,
  DOWNLOADS,
  openShare,
  rangeDays,
  statsDashboard,
  statsDownload,
  type Download,
} from "@/lib/db/stats.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// DevStation's figures for whoever holds a share link an admin made: view and
// export, nothing else. Every account is a pseudonym, the Pro list is left
// out, and a revoked link opens nothing. No sign-in: the link is the access.
//
// GET ?token=<link secret>&days=7|30|90      the dashboard
// GET ?token=<link secret>&download=<file>   one of the downloads

const GONE = ["link_revoked", "This link was revoked, or it never existed.", 404] as const;

export const Route = createFileRoute("/api/stats/shared")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (
          !(await checkRateLimit(`stats-shared:${clientKeyFromRequest(request)}`, 120, 10 * 60_000))
        ) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        if (!dbConfigured()) return fail("not_configured", "The figures are not available.", 503);
        const url = new URL(request.url);
        try {
          const share = await openShare(url.searchParams.get("token"));
          if (!share) return fail(...GONE);
          const what = url.searchParams.get("download");
          if (what) {
            if (!(DOWNLOADS as readonly string[]).includes(what)) {
              return fail("invalid_download", "There is no such download.", 400);
            }
            return await statsDownload(what as Download);
          }
          const dashboard = await statsDashboard(rangeDays(url.searchParams.get("days")), true);
          void countView(share);
          return Response.json(
            { ok: true, label: share.label, dashboard },
            { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } },
          );
        } catch {
          return fail("db", "The figures could not be read just now.", 502);
        }
      },
    },
  },
});
