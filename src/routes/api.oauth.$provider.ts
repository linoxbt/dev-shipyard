import { createFileRoute } from "@tanstack/react-router";
import { dbConfigured } from "@/lib/db/admin.server";
import { isConnectorId } from "@/lib/db/connectors.server";
import { safeBack, startUrl } from "@/lib/db/oauth.server";
import { requestOwner } from "@/lib/db/request.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// GET /api/oauth/<provider>?back=/path: send the person to the provider to
// approve DevStation's access (lib/db/oauth.server.ts).

const backTo = (path: string, reason: string) =>
  new Response(null, {
    status: 302,
    headers: {
      location: `${path}${path.includes("?") ? "&" : "?"}connect_error=${encodeURIComponent(reason)}`,
    },
  });

export const Route = createFileRoute("/api/oauth/$provider")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const back = safeBack(url.searchParams.get("back"));
        const id = params.provider;
        if (!isConnectorId(id)) return backTo(back, "unknown");
        const owner = requestOwner(request);
        if (!owner) return backTo(back, "sign_in");
        if (!dbConfigured()) return backTo(back, "not_configured");
        if (!(await checkRateLimit(`oauth:${clientKeyFromRequest(request)}`, 20, 10 * 60_000))) {
          return backTo(back, "rate_limited");
        }
        let target: string | null = null;
        try {
          target = startUrl(request, id, owner, back);
        } catch {
          target = null;
        }
        if (!target) return backTo(back, "not_configured");
        return new Response(null, { status: 302, headers: { location: target } });
      },
    },
  },
});
