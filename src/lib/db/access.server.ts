// Who may use which model, and what it costs them (lib/billing/
// config.server.ts has the figures).
//
// The free model (Qwen, and Auto) costs nothing up to a daily allowance an
// admin sets (none by default); past it, calls are charged to credit. Every
// other model is charged to credit. Credit is launch credit (an amount, for a
// number of accounts, both set by an admin), top-ups and the credit Pro
// includes each month. Pro granted by an admin is unlimited. On top of that,
// the limits an admin sets (lib/billing/limits.server.ts) cap a run, a day
// and the runs in a day.

import { isPremiumModel, modelLabel } from "@/lib/coding-agent/models";
import {
  accountLimits,
  effectiveLimits,
  limitProblem,
  usageSettings,
  usageState,
  type Limits,
} from "@/lib/billing/limits.server";
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
  /** Launch credits still unclaimed (1000000 when there is no cap). */
  slotsLeft: number;
  /** The launch credit an account gets, in dollars (0: none is offered). */
  launchCreditUsd: number;
  /** The limits an admin set, which the model proxy enforces. */
  limits: Limits;
  /** Premium models are usable now. */
  premium: boolean;
  /** The free model's cost today (UTC) that was not charged. */
  freeUsedToday: number;
  /** Today's free allowance for this plan; null when there is no limit. */
  freeDailyUsd: number | null;
  /** False when the database is not set up: premium stays locked. */
  available: boolean;
}

export const NO_LIMITS: Limits = {
  runLimitUsd: null,
  dailyLimitUsd: null,
  runsPerDay: null,
  freeDailyUsd: null,
  paused: false,
  custom: false,
};

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
  launchCreditUsd: 0,
  limits: NO_LIMITS,
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
  const [settings, own] = await Promise.all([usageSettings(), accountLimits(owner)]);
  const claimed = Number(raw.claimed ?? 0);
  const spent = Number(raw.spent ?? 0);
  const balance = Math.max(0, Number((claimed - spent).toFixed(6)));
  const plan = raw.plan === "pro" ? "pro" : "free";
  const unlimited = plan === "pro" && Boolean(raw.unlimited);
  const limits = effectiveLimits({ plan, unlimited }, settings, own);
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
    launchCreditUsd: settings.launchCreditUsd,
    limits,
    premium: unlimited || balance > 0,
    freeUsedToday: Number(raw.free_used_today ?? 0),
    freeDailyUsd: limits.freeDailyUsd,
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
  const allowance = access.freeDailyUsd;
  const qwenFree = allowance === null || allowance > 0;
  if (isPremiumModel(model)) {
    const instead = qwenFree ? ", or use Qwen, which is free each day" : "";
    return access.balance > 0
      ? { pay: "credit" }
      : {
          refused:
            access.claimed > 0
              ? `Your credit is used up. Add credit to keep using ${modelLabel(model)}${instead}.`
              : `${modelLabel(model)} is paid for with credit. Add credit or upgrade to Pro${instead}.`,
        };
  }
  if (allowance === null || access.freeUsedToday < allowance) return { pay: "free" };
  if (access.balance > 0) return { pay: "credit" };
  if (allowance > 0) {
    return {
      refused:
        "Today's free allowance is used up. Add credit to keep going now, or come back tomorrow: it resets at 00:00 UTC.",
    };
  }
  return {
    refused:
      access.claimed > 0
        ? "Your credit is used up. Add credit to keep building."
        : access.slotsLeft > 0 && access.launchCreditUsd > 0
          ? "Claim your launch credit on the Credits page to start building."
          : "Add credit to start building.",
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
  if ("refused" in charge) return { status: 402, message: charge.refused };
  // The limits an admin set: checked as the message is sent, so a person
  // over a limit hears it now rather than from a run that stops at once.
  const problem = await startProblem(owner, access);
  return problem ? { status: 402, message: problem } : null;
}

/** Whether a new run may start under the account's limits (null: it may). */
export async function startProblem(owner: string, access: Access): Promise<string | null> {
  const l = access.limits;
  if (!l.paused && l.dailyLimitUsd === null && l.runsPerDay === null) return null;
  try {
    return limitProblem({ ...l, runLimitUsd: null }, await usageState(owner, null));
  } catch {
    // The proxy checks again on every call.
    return null;
  }
}
