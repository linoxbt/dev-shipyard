import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured, insert, rpc, select } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";

// DevStation's figures, for the people in ADMIN_EMAILS: totals, every agent
// turn and the daily site figures, as JSON or as CSV to download and publish;
// and granting Pro to an account that asked for it.

type Row = Record<string, unknown>;

function csv(rows: Row[], columns: string[]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join(
    "\n",
  );
}

function download(name: string, body: string, type: string): Response {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

const TURN_COLUMNS = [
  "created_at",
  "owner",
  "workspace",
  "turn",
  "model",
  "mode",
  "phase",
  "steps",
  "cost_usd",
  "files_changed",
  "premium",
];

const setPlan = z.object({
  action: z.literal("set_plan"),
  owner: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  plan: z.enum(["free", "pro"]),
});

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
        const what = new URL(request.url).searchParams.get("download");
        try {
          if (what === "turns.csv") {
            const rows = await select<Row>(
              "agent_turns",
              `select=${TURN_COLUMNS.join(",")}&order=created_at.asc&limit=100000`,
            );
            return download("devstation-turns.csv", csv(rows, TURN_COLUMNS), "text/csv");
          }
          if (what === "daily.csv") {
            const rows = await select<Row>("site_daily", "select=day,metric,count&order=day.asc");
            return download(
              "devstation-daily.csv",
              csv(rows, ["day", "metric", "count"]),
              "text/csv",
            );
          }
          const [summary, daily, requests] = await Promise.all([
            rpc<Row>("devstation_stats"),
            select<Row>("site_daily", "select=day,metric,count&order=day.desc&limit=90"),
            select<Row>(
              "account_plans",
              "select=owner,plan,pro_requested_at&pro_requested_at=not.is.null&order=pro_requested_at.desc",
            ),
          ]);
          const payload = { summary, daily, proRequests: requests };
          if (what === "summary.json") {
            return download(
              "devstation-stats.json",
              JSON.stringify(payload, null, 2),
              "application/json",
            );
          }
          return Response.json({ ok: true, ...payload });
        } catch {
          return fail("db", "The figures could not be read.", 502);
        }
      },

      POST: async ({ request }) => {
        if (!isAdmin(requestOwner(request))) {
          return fail("forbidden", "This page is for DevStation's admins.", 403);
        }
        const parsed = setPlan.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        try {
          await insert(
            "account_plans",
            {
              owner: parsed.data.owner,
              plan: parsed.data.plan,
              updated_at: new Date().toISOString(),
            },
            { upsertOn: "owner" },
          );
          return Response.json({ ok: true });
        } catch {
          return fail("db", "The plan could not be changed.", 502);
        }
      },
    },
  },
});
