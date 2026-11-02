import { createHash } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { bumpMetric } from "@/lib/db/admin.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// A visit, counted at most once per visitor per day. Only a number per day is
// kept, and no cookie is set: a visitor is recognised for the day by a hash of
// their address, browser and the date (never stored with anything else, and
// meaningless the next day). Crawlers and anything that is not a browser page
// (no Sec-Fetch-Site) are not counted. The figure is approximate by nature.

const BOT =
  /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|curl|wget|python|axios|node-fetch/i;

export const Route = createFileRoute("/api/metrics")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const agent = request.headers.get("user-agent") ?? "";
        const browser = request.headers.get("sec-fetch-site") === "same-origin";
        if (!browser || BOT.test(agent)) return new Response(null, { status: 204 });
        const day = new Date().toISOString().slice(0, 10);
        const visitor = createHash("sha256")
          .update(
            `${process.env.SESSION_SECRET ?? ""}|${clientKeyFromRequest(request)}|${agent}|${day}`,
          )
          .digest("hex")
          .slice(0, 32);
        if (await checkRateLimit(`visit:${visitor}`, 1, 24 * 60 * 60_000)) {
          await bumpMetric("visits");
        }
        return new Response(null, { status: 204 });
      },
    },
  },
});
