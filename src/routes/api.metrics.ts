import { createFileRoute } from "@tanstack/react-router";
import { bumpMetric } from "@/lib/db/admin.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// A visit, counted once per browser session (the page sends it). Only a
// number per day is kept: no cookie, no address, nothing about the visitor.

export const Route = createFileRoute("/api/metrics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (await checkRateLimit(`visit:${clientKeyFromRequest(request)}`, 30, 60 * 60_000)) {
          await bumpMetric("visits");
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
