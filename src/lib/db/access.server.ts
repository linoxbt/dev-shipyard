// Who may use which model, and what it costs them (lib/billing/
// config.server.ts has the figures).
//
// The free model (Qwen, and Auto) costs nothing up to a daily allowance; past
// it, calls are charged to credit. Every other model is charged to credit.
// Credit is launch credit ($5 for each of the first 20 accounts), top-ups and
// the credit Pro includes each month. Pro granted by an admin is unlimited.

import { isPremiumModel, modelLabel } from "@/lib/coding-agent/models";
import { billingConfig } from "@/lib/billing/config.server";
import { dbConfigured, rpc } from "./admin.server";

export interface Access {
  plan: "free" | "pro";
  /** Pro granted by an admin: no allowance, no charge. */
  unlimited: boolean;
  /** How Pro was bought: "subscription" (renews), "pass" (30 days), or null. */
  billing: "subscription" | "pass" | null;
  /** When paid Pro ends (or renews), ISO; null when not paid Pro. */
  proUntil: string | null;
  /** A Stripe customer exists: the billing portal can open. */
  portal: boolean;
  /** A Stripe subscription is running. */
  subscribed: boolean;
  proRequested: boolean;
  /** Launch credit claimed, in dollars (0 or 5). */
  launch: number;
  /** All credit added: launch credit, top-ups, Pro's included credit. */
  claimed: number;
  /** Charged so far. */
  spent: number;
  /** Claimed minus spent, never below zero. */
  balance: number;
  /** Launch credits still unclaimed, of 20. */
  slotsLeft: number;
  /** Premium models are usable now. */
  premium: boolean;
  /** The free model's cost today (UTC) that was not charged. */
  freeUsedToday: number;
  /** Today's free allowance for this plan; null when there is no limit. */
  freeDailyUsd: number | null;
  /** False when the database is not set up: premium stays locked. */
  available: boolean;
}

const LOCKED: Access = {
  plan: "free",
  unlimited: false,
  billing: null,
  proUntil: null,
  portal: false,
  subscribed: false,
  proRequested: false,
  launch: 0,
  claimed: 0,
  spent: 0,
  balance: 0,
  slotsLeft: 0,
  premium: false,
  freeUsedToday: 0,
  freeDailyUsd: null,
  available: false,
};

export async function accessOf(owner: string): Promise<Access> {
  if (!dbConfigured()) return LOCKED;
  const raw = await rpc<{
    plan?: string;
    unlimited?: boolean | null;
    billing?: string | null;
    pro_until?: string | null;
    portal?: boolean | null;
    subscribed?: boolean | null;
    pro_requested?: boolean | null;
    launch?: number | string;
    claimed?: number | string;
    spent?: number | string;
    free_used_today?: number | string;
    slots_left?: number;
  }>("account_access", { p_owner: owner });
  const config = billingConfig();
  const claimed = Number(raw.claimed ?? 0);
  const spent = Number(raw.spent ?? 0);
  const balance = Math.max(0, Number((claimed - spent).toFixed(6)));
  const plan = raw.plan === "pro" ? "pro" : "free";
  const unlimited = plan === "pro" && Boolean(raw.unlimited);
  return {
    plan,
    unlimited,
    billing: raw.billing === "subscription" || raw.billing === "pass" ? raw.billing : null,
    proUntil: raw.pro_until ?? null,
    portal: Boolean(raw.portal),
    subscribed: Boolean(raw.subscribed),
    proRequested: Boolean(raw.pro_requested),
    launch: Number(raw.launch ?? 0),
    claimed,
    spent,
    balance,
    slotsLeft: Number(raw.slots_left ?? 0),
    premium: unlimited || balance > 0,
    freeUsedToday: Number(raw.free_used_today ?? 0),
    freeDailyUsd: unlimited ? null : plan === "pro" ? config.proFreeDailyUsd : config.freeDailyUsd,
    available: true,
  };
}

/**
 * How one model call is paid for: "free" (the free model within today's
 * allowance, or an unlimited account), "credit" (charged at cost times the
 * margin), or refused with the reason to show.
 */
export function chargeFor(
  access: Access,
  model: string | undefined,
): { pay: "free" | "credit" } | { refused: string } {
  if (access.unlimited) return { pay: "free" };
  if (isPremiumModel(model)) {
    return access.balance > 0
      ? { pay: "credit" }
      : {
          refused:
            access.claimed > 0
              ? `Your credit is used up. Add credit to keep using ${modelLabel(model)}, or switch to Qwen, which is free each day.`
              : `${modelLabel(model)} is paid for with credit. Add credit or upgrade to Pro, or use Qwen, which is free each day.`,
        };
  }
  const allowance = access.freeDailyUsd;
  if (allowance === null || access.freeUsedToday < allowance) return { pay: "free" };
  return access.balance > 0
    ? { pay: "credit" }
    : {
        refused:
          "Today's free allowance is used up. Add credit to keep going now, or come back tomorrow: it resets at 00:00 UTC.",
      };
}

/** Null when this account may run the model now, or why not (with the status
 *  to answer: 402 needs credit or an upgrade, 503 plans could not be checked). */
export async function modelProblem(
  owner: string,
  model: string | undefined,
): Promise<{ status: 402 | 503; message: string } | null> {
  if (!dbConfigured()) {
    return isPremiumModel(model)
      ? {
          status: 402,
          message: `${modelLabel(model)} is not available on DevStation yet. Qwen is free and ready.`,
        }
      : null;
  }
  let access: Access;
  try {
    access = await accessOf(owner);
  } catch {
    return isPremiumModel(model)
      ? { status: 503, message: "Plans could not be checked just now. Try again in a moment." }
      : null;
  }
  const charge = chargeFor(access, model);
  return "refused" in charge ? { status: 402, message: charge.refused } : null;
}
