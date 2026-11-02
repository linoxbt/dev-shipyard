import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured, insert, select } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";
import {
  createShare,
  DOWNLOADS,
  listShares,
  rangeDays,
  revokeShare,
  statsDashboard,
  statsDownload,
  type Download,
} from "@/lib/db/stats.server";

// DevStation's figures, for the people in ADMIN_EMAILS: the dashboard for a
// period, the downloads, granting Pro to an account that asked for it, and
// read-only share links (made, listed and revoked here; opened through
// api/stats/shared).

type Row = Record<string, unknown>;

export { csv } from "@/lib/db/stats.server";

const actions = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set_plan"),
    owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    plan: z.enum(["free", "pro"]),
  }),
  z.object({ action: z.literal("create_share"), label: z.string().trim().max(80).default("") }),
  z.object({ action: z.literal("revoke_share"), id: z.string().uuid() }),
]);

export const Route = createFileRoute("/api/admin/stats")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!isAdmin(owner)) return fail("forbidden", "This page is for DevStation's admins.", 403);
        if (!dbConfigured()) {
          return fail(
            "not_configured",
            "Add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.",
            503,
          );
        }
        const url = new URL(request.url);
        const what = url.searchParams.get("download");
        try {
          if (what && (DOWNLOADS as readonly string[]).includes(what)) {
            return await statsDownload(what as Download);
          }
          if (url.searchParams.get("shares") === "1") {
            return Response.json(
              { ok: true, shares: await listShares() },
              { headers: { "cache-control": "no-store" } },
            );
          }
          const [dashboard, requests] = await Promise.all([
            statsDashboard(rangeDays(url.searchParams.get("days")), false),
            select<Row>(
              "account_plans",
              "select=owner,plan,contact,pro_requested_at&or=(pro_requested_at.not.is.null,plan.eq.pro)&order=pro_requested_at.desc.nullslast",
            ),
          ]);
          return Response.json(
            { ok: true, dashboard, proRequests: requests },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return fail("db", "The figures could not be read.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!isAdmin(owner)) return fail("forbidden", "This page is for DevStation's admins.", 403);
        const parsed = actions.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const data = parsed.data;
        try {
          if (data.action === "create_share") {
            const made = await createShare(owner!, data.label);
            return Response.json({ ok: true, ...made });
          }
          if (data.action === "revoke_share") {
            const revoked = await revokeShare(data.id);
            return revoked
              ? Response.json({ ok: true })
              : fail("not_found", "That link is already revoked or does not exist.", 404);
          }
          await insert(
            "account_plans",
            { owner: data.owner, plan: data.plan, updated_at: new Date().toISOString() },
            { upsertOn: "owner" },
          );
          return Response.json({ ok: true });
        } catch {
          return fail("db", "That could not be saved.", 502);
        }
      },
    },
  },
});
