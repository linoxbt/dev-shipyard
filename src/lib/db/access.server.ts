// Who may use which model, and the launch credit.
//
// Qwen (and Auto) is free. Every other model needs the Pro plan, or launch
// credit left: $5 for each of the first 20 accounts that claim it, spent at
// the real cost of each premium turn (recorded in agent_turns).

import { isPremiumModel, modelLabel } from "@/lib/coding-agent/models";
import { dbConfigured, rpc } from "./admin.server";

export interface Access {
  plan: "free" | "pro";
  proRequested: boolean;
  /** Launch credit claimed, in dollars (0 or 5). */
  claimed: number;
  /** Spent on premium models so far. */
  spent: number;
  /** Claimed minus spent, never below zero. */
  balance: number;
  /** Launch credits still unclaimed, of 20. */
  slotsLeft: number;
  /** Premium models are usable now. */
  premium: boolean;
  /** False when the database is not set up: premium stays locked. */
  available: boolean;
}

const LOCKED: Access = {
  plan: "free",
  proRequested: false,
  claimed: 0,
  spent: 0,
  balance: 0,
  slotsLeft: 0,
  premium: false,
  available: false,
};

export async function accessOf(owner: string): Promise<Access> {
  if (!dbConfigured()) return LOCKED;
  const raw = await rpc<{
    plan?: string;
    pro_requested?: boolean | null;
    claimed?: number | string;
    spent?: number | string;
    slots_left?: number;
  }>("account_access", { p_owner: owner });
  const claimed = Number(raw.claimed ?? 0);
  const spent = Number(raw.spent ?? 0);
  const balance = Math.max(0, claimed - spent);
  const plan = raw.plan === "pro" ? "pro" : "free";
  return {
    plan,
    proRequested: Boolean(raw.pro_requested),
    claimed,
    spent,
    balance,
    slotsLeft: Number(raw.slots_left ?? 0),
    premium: plan === "pro" || balance > 0,
    available: true,
  };
}

/** Null when this account may run the model, or why not. */
export async function modelProblem(
  owner: string,
  model: string | undefined,
): Promise<string | null> {
  if (!isPremiumModel(model)) return null;
  const access = await accessOf(owner).catch(() => LOCKED);
  if (access.premium) return null;
  return access.claimed > 0
    ? `Your launch credit is used up. Upgrade to keep using ${modelLabel(model)}, or switch to Qwen, which is free.`
    : `${modelLabel(model)} needs an upgrade. Claim launch credit or request Pro, or use Qwen, which is free.`;
}
