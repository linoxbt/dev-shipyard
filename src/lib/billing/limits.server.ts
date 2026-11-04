import { insert, remove, rpc, select, update } from "@/lib/db/admin.server";
import { billingConfig } from "./config.server";

// The limits an admin sets on model use (routes/admin.limits.tsx), and the
// check the model proxy makes before every call (routes/api.model.ts).
//
// The settings cover the free plan: the launch credit (how much, how many
// accounts), the free model's daily allowance, and how much one run (the
// work one message starts), one day, and how many runs a day may take.
// An admin can set any of those for one account instead. Pro and admin-
// granted accounts follow only the limits set on them by name.

export interface UsageSettings {
  launchCreditUsd: number;
  /** Accounts that get the launch credit; null for every account. */
  launchSlots: number | null;
  /** Free-model cost an account may use a day without credit; 0 for none. */
  freeDailyUsd: number;
  runLimitUsd: number | null;
  dailyLimitUsd: number | null;
  runsPerDay: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface AccountLimits {
  owner: string;
  runLimitUsd: number | null;
  dailyLimitUsd: number | null;
  runsPerDay: number | null;
  freeDailyUsd: number | null;
  noRunLimit: boolean;
  noDailyLimit: boolean;
  noRunsLimit: boolean;
  paused: boolean;
  note: string;
  updatedAt: string | null;
}

/** The limits one account is held to now. */
export interface Limits {
  runLimitUsd: number | null;
  dailyLimitUsd: number | null;
  runsPerDay: number | null;
  /** Free-model allowance a day; null for no limit. */
  freeDailyUsd: number | null;
  paused: boolean;
  /** An admin set something for this account by name. */
  custom: boolean;
}

/** What an account has used, for the check. */
export interface UsageState {
  daySpent: number;
  runSpent: number;
  runsToday: number;
  /** This run has made a call already (it is counted in runsToday). */
  runSeen: boolean;
}

type SettingsRow = {
  launch_credit_usd: number | string;
  launch_slots: number | null;
  free_daily_usd: number | string;
  run_limit_usd: number | string | null;
  daily_limit_usd: number | string | null;
  runs_per_day: number | null;
  updated_at: string | null;
  updated_by: string | null;
};

type LimitsRow = {
  owner: string;
  run_limit_usd: number | string | null;
  daily_limit_usd: number | string | null;
  runs_per_day: number | null;
  free_daily_usd: number | string | null;
  no_run_limit: boolean;
  no_daily_limit: boolean;
  no_runs_limit: boolean;
  paused: boolean;
  note: string;
  updated_at: string | null;
};

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

/** Until the settings table exists: what the environment says, as before. */
export function fallbackSettings(): UsageSettings {
  const c = billingConfig();
  return {
    launchCreditUsd: 5,
    launchSlots: 20,
    freeDailyUsd: c.freeDailyUsd ?? 0,
    runLimitUsd: null,
    dailyLimitUsd: null,
    runsPerDay: null,
    updatedAt: null,
    updatedBy: null,
  };
}

const fromSettings = (r: SettingsRow): UsageSettings => ({
  launchCreditUsd: Number(r.launch_credit_usd),
  launchSlots: r.launch_slots,
  freeDailyUsd: Number(r.free_daily_usd),
  runLimitUsd: num(r.run_limit_usd),
  dailyLimitUsd: num(r.daily_limit_usd),
  runsPerDay: r.runs_per_day,
  updatedAt: r.updated_at,
  updatedBy: r.updated_by,
});

const fromLimits = (r: LimitsRow): AccountLimits => ({
  owner: r.owner,
  runLimitUsd: num(r.run_limit_usd),
  dailyLimitUsd: num(r.daily_limit_usd),
  runsPerDay: r.runs_per_day,
  freeDailyUsd: num(r.free_daily_usd),
  noRunLimit: r.no_run_limit,
  noDailyLimit: r.no_daily_limit,
  noRunsLimit: r.no_runs_limit,
  paused: r.paused,
  note: r.note,
  updatedAt: r.updated_at,
});

// Read on every model call: kept for a few seconds per server instance. An
// admin's change reaches every instance within that.
const TTL_MS = 15_000;
let settingsCache: { at: number; value: UsageSettings } | null = null;
const limitsCache = new Map<string, { at: number; value: AccountLimits | null }>();

export async function usageSettings(fresh = false): Promise<UsageSettings> {
  if (!fresh && settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value;
  try {
    const [row] = await select<SettingsRow>("usage_settings", "select=*&id=eq.true");
    const value = row ? fromSettings(row) : fallbackSettings();
    settingsCache = { at: Date.now(), value };
    return value;
  } catch {
    return settingsCache?.value ?? fallbackSettings();
  }
}

export async function accountLimits(owner: string, fresh = false): Promise<AccountLimits | null> {
  const hit = limitsCache.get(owner);
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.value;
  try {
    const [row] = await select<LimitsRow>(
      "account_limits",
      `select=*&owner=eq.${encodeURIComponent(owner)}`,
    );
    const value = row ? fromLimits(row) : null;
    if (limitsCache.size > 5000) limitsCache.clear();
    limitsCache.set(owner, { at: Date.now(), value });
    return value;
  } catch {
    return hit?.value ?? null;
  }
}

/**
 * The limits an account is held to. The settings apply to the free plan;
 * Pro and admin-granted accounts have only what was set on them by name.
 */
export function effectiveLimits(
  plan: { plan: "free" | "pro"; unlimited: boolean },
  settings: UsageSettings,
  own: AccountLimits | null,
): Limits {
  const free = plan.plan === "free";
  const pick = (mine: number | null, off: boolean, fallback: number | null) =>
    off ? null : (mine ?? (free ? fallback : null));
  const config = billingConfig();
  return {
    runLimitUsd: pick(own?.runLimitUsd ?? null, !!own?.noRunLimit, settings.runLimitUsd),
    dailyLimitUsd: pick(own?.dailyLimitUsd ?? null, !!own?.noDailyLimit, settings.dailyLimitUsd),
    runsPerDay: pick(own?.runsPerDay ?? null, !!own?.noRunsLimit, settings.runsPerDay),
    freeDailyUsd: plan.unlimited
      ? null
      : (own?.freeDailyUsd ?? (free ? settings.freeDailyUsd : config.proFreeDailyUsd)),
    paused: !!own?.paused,
    custom: !!own,
  };
}

export async function usageState(owner: string, turn: string | null): Promise<UsageState> {
  const raw = await rpc<{
    day_spent?: number | string;
    run_spent?: number | string;
    runs_today?: number;
    run_seen?: boolean;
  }>("usage_state", { p_owner: owner, p_turn: turn });
  return {
    daySpent: Number(raw.day_spent ?? 0),
    runSpent: Number(raw.run_spent ?? 0),
    runsToday: Number(raw.runs_today ?? 0),
    runSeen: Boolean(raw.run_seen),
  };
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * Why this account may not make a model call now, or null. `turn` is the
 * run the call belongs to; null when a message is about to start one.
 */
export function limitProblem(limits: Limits, state: UsageState): string | null {
  if (limits.paused) {
    return "Model use is paused on this account. Contact DevStation to have it turned back on.";
  }
  if (limits.dailyLimitUsd !== null && state.daySpent >= limits.dailyLimitUsd) {
    return `You have used today's limit of ${usd(limits.dailyLimitUsd)}. It resets at 00:00 UTC.`;
  }
  if (limits.runsPerDay !== null && !state.runSeen && state.runsToday >= limits.runsPerDay) {
    return `You have started ${state.runsToday} runs today, the most for one day. Runs reset at 00:00 UTC.`;
  }
  if (limits.runLimitUsd !== null && state.runSpent >= limits.runLimitUsd) {
    return `This run reached its limit of ${usd(limits.runLimitUsd)}. Send another message to carry on from where it stopped.`;
  }
  return null;
}

/** The run a model call belongs to: its workspace and when it started. */
export const turnKey = (workspace: string, started: number) =>
  `${workspace.slice(0, 120)}:${started}`;

// ------------------------------------------------------------------ admin

export async function saveSettings(
  patch: Partial<Omit<UsageSettings, "updatedAt" | "updatedBy">>,
  by: string,
): Promise<UsageSettings> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString(), updated_by: by };
  if (patch.launchCreditUsd !== undefined) row.launch_credit_usd = patch.launchCreditUsd;
  if (patch.launchSlots !== undefined) row.launch_slots = patch.launchSlots;
  if (patch.freeDailyUsd !== undefined) row.free_daily_usd = patch.freeDailyUsd;
  if (patch.runLimitUsd !== undefined) row.run_limit_usd = patch.runLimitUsd;
  if (patch.dailyLimitUsd !== undefined) row.daily_limit_usd = patch.dailyLimitUsd;
  if (patch.runsPerDay !== undefined) row.runs_per_day = patch.runsPerDay;
  const saved = await update<SettingsRow>("usage_settings", "id=eq.true", row);
  if (!saved.length) await insert("usage_settings", { id: true, ...row });
  return usageSettings(true);
}

export async function saveAccountLimits(
  owner: string,
  patch: Omit<AccountLimits, "owner" | "updatedAt">,
  by: string,
): Promise<AccountLimits | null> {
  await insert(
    "account_limits",
    {
      owner,
      run_limit_usd: patch.runLimitUsd,
      daily_limit_usd: patch.dailyLimitUsd,
      runs_per_day: patch.runsPerDay,
      free_daily_usd: patch.freeDailyUsd,
      no_run_limit: patch.noRunLimit,
      no_daily_limit: patch.noDailyLimit,
      no_runs_limit: patch.noRunsLimit,
      paused: patch.paused,
      note: patch.note.slice(0, 500),
      updated_at: new Date().toISOString(),
      updated_by: by,
    },
    { upsertOn: "owner" },
  );
  return accountLimits(owner, true);
}

export async function clearAccountLimits(owner: string): Promise<void> {
  await remove("account_limits", `owner=eq.${encodeURIComponent(owner)}`);
  limitsCache.delete(owner);
}

export async function allAccountLimits(): Promise<AccountLimits[]> {
  const rows = await select<LimitsRow>("account_limits", "select=*&limit=1000");
  return rows.map(fromLimits);
}
