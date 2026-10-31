import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured } from "@/lib/db/admin.server";
import {
  CONNECTOR_IDS,
  deleteConnector,
  listConnectors,
  saveConnector,
} from "@/lib/db/connectors.server";
import { fail, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// Accounts the agent may act as (lib/db/connectors.server.ts). Tokens go in
// and are never sent back out: the list only says what is connected.

const save = z.object({
  provider: z.enum(CONNECTOR_IDS as [string, ...string[]]),
  token: z.string().min(1).max(2000),
});
const drop = z.object({ provider: z.enum(CONNECTOR_IDS as [string, ...string[]]) });

export const Route = createFileRoute("/api/connectors")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return Response.json({ ok: true, available: false, connected: [] });
        try {
          return Response.json({
            ok: true,
            available: true,
            connected: await listConnectors(owner),
          });
        } catch {
          return fail("db", "Your connections could not be read.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Connections are not set up yet.", 503);
        if (!(await checkRateLimit(`connect:${clientKeyFromRequest(request)}`, 20, 10 * 60_000))) {
          return fail("rate_limited", "Too many attempts. Wait a moment.", 429);
        }
        const parsed = save.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const result = await saveConnector(
          owner,
          parsed.data.provider as (typeof CONNECTOR_IDS)[number],
          parsed.data.token,
        ).catch(() => ({ ok: false as const, message: "That could not be saved." }));
        if (!result.ok) return fail("rejected", result.message, 400);
        return Response.json({ ok: true, label: result.label });
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
