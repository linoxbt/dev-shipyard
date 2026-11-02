// DevStation's economics, in one place. Every figure has a sound default and
// an environment variable to change it; nothing here needs a deploy of code.
//
//   Free         the free model (Qwen) up to FREE_DAILY_USD of model cost a
//                day per account, then from credit
//   Pay as you   credit bought in top-ups; every charged call costs the
//   go           model's own price times BILLING_MARKUP (the platform's margin)
//   Pro          PRO_PRICE_USD a month: PRO_INCLUDED_CREDIT_USD of credit each
//                month and PRO_FREE_DAILY_USD of free-model use a day
//
// Pro granted by an admin (account_plans.billing null) stays unlimited.

export type Provider = "stripe" | "paystack";

export interface BillingConfig {
  /** What a charged call costs, as a multiple of the model's own price. */
  markup: number;
  /** Free-model cost an account may use a day without credit; null: no limit. */
  freeDailyUsd: number | null;
  /** The same, for Pro. */
  proFreeDailyUsd: number | null;
  proPriceUsd: number;
  proIncludedUsd: number;
  /** Top-up amounts offered, in dollars. */
  topUps: number[];
  minTopUpUsd: number;
  maxTopUpUsd: number;
  /** Gateways with their keys set, in the order they are offered. */
  providers: Provider[];
  /** Paystack charges in this currency: USD, or the local one at a rate. */
  paystackCurrency: string;
  /** Local units per US dollar when Paystack charges in another currency. */
  paystackRate: number;
}

function money(raw: string | undefined, fallback: number, min = 0, max = 100_000): number {
  const n = Number(raw);
  return Number.isFinite(n) && raw !== undefined && raw !== ""
    ? Math.min(max, Math.max(min, n))
    : fallback;
}

function limit(raw: string | undefined, fallback: number): number | null {
  if (raw && /^(unlimited|none|off)$/i.test(raw.trim())) return null;
  return money(raw, fallback);
}

export function billingConfig(env: NodeJS.ProcessEnv = process.env): BillingConfig {
  const providers: Provider[] = [];
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) providers.push("stripe");
  if (env.PAYSTACK_SECRET_KEY) providers.push("paystack");
  const currency = (env.PAYSTACK_CURRENCY || "USD").toUpperCase();
  return {
    markup: money(env.BILLING_MARKUP, 1.25, 1, 5),
    freeDailyUsd: limit(env.FREE_DAILY_USD, 0.5),
    proFreeDailyUsd: limit(env.PRO_FREE_DAILY_USD, 5),
    proPriceUsd: money(env.PRO_PRICE_USD, 20, 1),
    proIncludedUsd: money(env.PRO_INCLUDED_CREDIT_USD, 20),
    topUps: [10, 25, 50, 100],
    minTopUpUsd: 5,
    maxTopUpUsd: 1000,
    providers,
    paystackCurrency: currency,
    paystackRate: currency === "USD" ? 1 : money(env.PAYSTACK_USD_RATE, 0, 0),
  };
}

/** What the browser may know of it (no keys, nothing secret). */
export function publicBillingConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = billingConfig(env);
  return {
    markup: c.markup,
    freeDailyUsd: c.freeDailyUsd,
    proFreeDailyUsd: c.proFreeDailyUsd,
    proPriceUsd: c.proPriceUsd,
    proIncludedUsd: c.proIncludedUsd,
    topUps: c.topUps,
    minTopUpUsd: c.minTopUpUsd,
    maxTopUpUsd: c.maxTopUpUsd,
    // Paystack in a local currency needs its rate, or it is not offered.
    providers: c.providers.filter((p) => p !== "paystack" || c.paystackRate > 0),
    paystackCurrency: c.paystackCurrency,
  };
}
