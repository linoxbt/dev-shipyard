import { createFileRoute } from "@tanstack/react-router";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { dbConfigured, insert, rpc } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";
import {
  allAccountLimits,
  clearAccountLimits,
  saveAccountLimits,
  saveSettings,
  usageSettings,
} from "@/lib/billing/limits.server";

// Usage limits, for the people in ADMIN_EMAILS (routes/admin.limits.tsx):
//
// GET                                   the settings and every member's use
// POST {action: "settings", ...}        the launch credit, the free allowance,
//                                       and the limits for the free plan
// POST {action: "account", owner, ...}  limits for one account
// POST {action: "clear", owner}         one account back to the settings
// POST {action: "credit", owner, amountUsd, note}   add (or take) credit

const OWNER = z.string().regex(/^0x[0-9a-f]{40}$/);
const usd = z.number().min(0).max(10_000);
const limit = z.number().gt(0).max(10_000).nullable();

const actions = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("settings"),
    launchCreditUsd: usd.optional(),
    launchSlots: z.number().int().min(0).max(10_000_000).nullable().optional(),
    freeDailyUsd: usd.optional(),
    runLimitUsd: limit.optional(),
    dailyLimitUsd: limit.optional(),
    runsPerDay: z.number().int().min(1).max(10_000).nullable().optional(),
  }),
  z.object({
    action: z.literal("account"),
    owner: OWNER,
    runLimitUsd: limit,
    dailyLimitUsd: limit,
    runsPerDay: z.number().int().min(1).max(10_000).nullable(),
    freeDailyUsd: usd.nullable(),
    noRunLimit: z.boolean(),
    noDailyLimit: z.boolean(),
    noRunsLimit: z.boolean(),
    paused: z.boolean(),
    note: z.string().max(500),
  }),
  z.object({ action: z.literal("clear"), owner: OWNER }),
  z.object({
    action: z.literal("credit"),
    owner: OWNER,
    amountUsd: z
      .number()
      .min(-10_000)
      .max(10_000)
      .refine((n) => n !== 0),
    note: z.string().max(200),
  }),
]);

interface OverviewRow {
  owner: string;
  email: string | null;
  plan: string;
  unlimited: boolean;
  credit: number | string;
  spent: number | string;
  day_spent: number | string;
  runs_today: number | string;
  last_used: string | null;
}

const NOT_SET_UP = [
  "not_configured",
  "Add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.",
  503,
] as const;

async function overview() {
  const [settings, rows, limits] = await Promise.all([
    usageSettings(true),
    rpc<OverviewRow[]>("admin_usage_overview"),
    allAccountLimits(),
  ]);
  const own = new Map(limits.map((l) => [l.owner, l]));
  return {
    ok: true,
    settings,
    accounts: rows.map((r) => {
      const credit = Number(r.credit);
      const spent = Number(r.spent);
      return {
        owner: r.owner,
        email: r.email,
        plan: r.plan === "pro" ? "pro" : "free",
        unlimited: r.unlimited,
        credit,
        spent,
        balance: Math.max(0, Number((credit - spent).toFixed(4))),
        todaySpent: Number(r.day_spent),
        runsToday: Number(r.runs_today),
        lastUsed: r.last_used,
        limits: own.get(r.owner) ?? null,
      };
    }),
  };
}

export const Route = createFileRoute("/api/admin/limits")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!isAdmin(owner)) return fail("forbidden", "This page is for DevStation's admins.", 403);
        if (!dbConfigured()) return fail(...NOT_SET_UP);
        try {
          return Response.json(await overview(), { headers: { "cache-control": "no-store" } });
        } catch (error) {
          console.error("admin limits", error);
          return fail("db", "Limits could not be read just now.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner || !isAdmin(owner)) {
          return fail("forbidden", "This page is for DevStation's admins.", 403);
        }
        if (!dbConfigured()) return fail(...NOT_SET_UP);
        const parsed = actions.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Those values are not valid.", 400);
        const data = parsed.data;
        try {
          if (data.action === "settings") {
            const { action: _a, ...patch } = data;
            await saveSettings(patch, owner);
          } else if (data.action === "account") {
            const { action: _a, owner: who, ...patch } = data;
            await saveAccountLimits(who, patch, owner);
          } else if (data.action === "clear") {
            await clearAccountLimits(data.owner);
          } else {
            await insert("credit_ledger", {
              owner: data.owner,
              amount_usd: data.amountUsd,
              kind: "adjustment",
              reference: `admin:${randomUUID()}`,
              note: (data.note || "Added by DevStation").slice(0, 200),
            });
          }
          return Response.json(await overview());
        } catch (error) {
          console.error("admin limits", error);
          return fail("db", "That did not save. Try again in a moment.", 502);
        }
      },
    },
  },
});
