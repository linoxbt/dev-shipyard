import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured } from "@/lib/db/admin.server";
import { CONNECTOR_IDS, deleteConnector, listConnectors } from "@/lib/db/connectors.server";
import { oauthConfigured } from "@/lib/db/oauth.server";
import { fail, requestOwner } from "@/lib/db/request.server";

// Accounts the agent may act as (lib/db/connectors.server.ts). They are
// connected over OAuth (/api/oauth/<provider>); this lists what is connected
// and removes a connection. Tokens are never sent back out.

const drop = z.object({ provider: z.enum(CONNECTOR_IDS as [string, ...string[]]) });

export const Route = createFileRoute("/api/connectors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        const configured = oauthConfigured();
        if (!dbConfigured()) {
          return Response.json({ ok: true, available: false, configured, connected: [] });
        }
        try {
          return Response.json({
            ok: true,
            available: true,
            configured,
            connected: await listConnectors(owner),
          });
        } catch {
          return fail("db", "Your connections could not be read.", 502);
        }
      },

      DELETE: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        const parsed = drop.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        try {
          await deleteConnector(owner, parsed.data.provider as (typeof CONNECTOR_IDS)[number]);
          return Response.json({ ok: true });
        } catch {
          return fail("db", "That could not be removed.", 502);
        }
      },
    },
  },
});
