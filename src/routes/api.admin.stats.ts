import { createHmac } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured, insert, rpc, select, selectAll } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";

// DevStation's figures, for the people in ADMIN_EMAILS: totals, every agent
// turn and the daily site figures, as JSON or as CSV to download and publish;
// and granting Pro to an account that asked for it.

type Row = Record<string, unknown>;

export function csv(rows: Row[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // A cell a spreadsheet would run as a formula is kept as text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join(
    "\n",
  );
}

/** A stable stand-in for an account in published figures. The account id is
 *  an unkeyed hash of an email, so anyone could hash an address and find that
 *  person's rows; this is keyed with the server's secret. */
function pseudonym(owner: unknown): string {
  const key = process.env.SESSION_SECRET || process.env.RUNNER_TOKEN || "devstation";
  return `acct_${createHmac("sha256", key).update(String(owner)).digest("hex").slice(0, 12)}`;
}

/** The first day of the last 90. */
function since90(now = new Date()): string {
  return new Date(now.getTime() - 89 * 24 * 60 * 60_000).toISOString().slice(0, 10);
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
  "account",
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
            const rows = await selectAll<Row>(
              "agent_turns",
              `select=${TURN_COLUMNS.map((c) => (c === "account" ? "owner" : c)).join(",")}&order=created_at.asc,id.asc`,
            );
            const published = rows.map(({ owner: who, ...rest }) => ({
              account: pseudonym(who),
              ...rest,
            }));
            return download("devstation-turns.csv", csv(published, TURN_COLUMNS), "text/csv");
          }
          if (what === "daily.csv") {
            const rows = await selectAll<Row>(
              "site_daily",
              "select=day,metric,count&order=day.asc,metric.asc",
            );
            return download(
              "devstation-daily.csv",
              csv(rows, ["day", "metric", "count"]),
              "text/csv",
            );
          }
          const [summary, daily] = await Promise.all([
            rpc<Row>("devstation_stats"),
            selectAll<Row>(
              "site_daily",
              `select=day,metric,count&day=gte.${since90()}&order=day.desc`,
            ),
          ]);
          if (what === "summary.json") {
            // For publishing: totals and daily figures, no accounts.
            return download(
              "devstation-stats.json",
              JSON.stringify({ summary, daily }, null, 2),
              "application/json",
            );
          }
          const requests = await select<Row>(
            "account_plans",
            "select=owner,plan,contact,pro_requested_at&or=(pro_requested_at.not.is.null,plan.eq.pro)&order=pro_requested_at.desc.nullslast",
          );
          return Response.json({ ok: true, summary, daily, proRequests: requests });
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
