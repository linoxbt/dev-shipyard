import { rpc, update } from "@/lib/db/admin.server";
import { billingConfig } from "./config.server";
import { paystackMinor, type PaystackTransaction } from "./paystack.server";
import type { StripeSession } from "./stripe.server";

// A confirmed payment becomes what it bought: credit for a top-up, Pro (with
// its included credit) for an upgrade. apply_payment in the database does it
// in one transaction and only once per payment, so a webhook delivered twice,
// or a webhook and the browser's return both confirming, add credit once.

export interface Paid {
  owner: string;
  provider: "stripe" | "paystack";
  /** The gateway's id for this payment (checkout session, invoice, reference). */
  ref: string;
  kind: "topup" | "pro";
  amountUsd: number;
  currency: string;
  amountMinor: number | null;
  /** Pro: when this paid period ends (subscriptions); null for a 30-day pass. */
  periodEnd?: Date | null;
  billing?: "subscription" | "pass";
  customer?: string | null;
  subscription?: string | null;
  meta?: Record<string, unknown>;
}

/** True when this payment was new and has been applied; false when it was
 *  already recorded. */
export async function applyPayment(p: Paid): Promise<boolean> {
  if (!/^0x[0-9a-f]{40}$/.test(p.owner)) throw new Error("A payment without an account.");
  if (!(p.amountUsd > 0)) throw new Error("A payment of nothing.");
  const included = p.kind === "pro" ? billingConfig().proIncludedUsd : 0;
  const applied = await rpc<boolean>("apply_payment", {
    p_owner: p.owner,
    p_provider: p.provider,
    p_ref: p.ref,
    p_kind: p.kind,
    p_amount: Number(p.amountUsd.toFixed(2)),
    p_currency: p.currency.toLowerCase(),
    p_minor: p.amountMinor,
    p_included: included,
    p_period_end: p.periodEnd ? p.periodEnd.toISOString() : null,
    p_billing: p.kind === "pro" ? (p.billing ?? "pass") : null,
    p_customer: p.customer ?? null,
    p_subscription: p.subscription ?? null,
    p_meta: p.meta ?? {},
  });
  return applied === true;
}

const OWNER = /^0x[0-9a-f]{40}$/;

// ------------------------------------------------------------------ Stripe

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** A top-up paid through Checkout (from its webhook, or the return page). */
export async function applyStripeSession(session: StripeSession | Json): Promise<boolean> {
  const s = obj(session);
  const meta = obj(s.metadata);
  const owner = str(meta.owner);
  if (s.mode !== "payment" || s.payment_status !== "paid" || meta.kind !== "topup") return false;
  if (!owner || !OWNER.test(owner)) return false;
  const total = Number(s.amount_total);
  return applyPayment({
    owner,
    provider: "stripe",
    ref: String(s.id),
    kind: "topup",
    amountUsd: total / 100,
    currency: str(s.currency) ?? "usd",
    amountMinor: total,
    customer: str(s.customer),
  });
}

/** Pro paid for a period: the first invoice of a subscription and every
 *  renewal. The account comes from the subscription's own metadata. */
export async function applyStripeInvoice(invoice: Json): Promise<boolean> {
  const parent = obj(obj(invoice.parent).subscription_details);
  const details = obj(invoice.subscription_details);
  const meta = { ...obj(details.metadata), ...obj(parent.metadata) };
  const owner = str(meta.owner);
  if (!owner || !OWNER.test(owner) || meta.kind !== "pro") return false;
  const paid = Number(invoice.amount_paid);
  if (!(paid > 0)) return false;
  const lines = obj(invoice.lines).data;
  const line = obj(Array.isArray(lines) ? lines[0] : null);
  const periodEnd = Number(obj(line.period).end);
  return applyPayment({
    owner,
    provider: "stripe",
    ref: String(invoice.id),
    kind: "pro",
    amountUsd: paid / 100,
    currency: str(invoice.currency) ?? "usd",
    amountMinor: paid,
    periodEnd: Number.isFinite(periodEnd) && periodEnd > 0 ? new Date(periodEnd * 1000) : null,
    billing: "subscription",
    customer: str(invoice.customer),
    subscription: str(invoice.subscription) ?? str(parent.subscription),
  });
}

/** A subscription ended: Pro runs to the end of what was paid, then stops. */
export async function endStripeSubscription(subscription: Json): Promise<void> {
  const id = str(subscription.id);
  if (!id) return;
  await update("account_plans", `stripe_subscription=eq.${encodeURIComponent(id)}`, {
    stripe_subscription: null,
    updated_at: new Date().toISOString(),
  });
}

/** Handle one verified Stripe event. Unknown events are fine: ignored. */
export async function handleStripeEvent(event: Json): Promise<void> {
  const data = obj(obj(event.data).object);
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await applyStripeSession(data);
      return;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      await applyStripeInvoice(data);
      return;
    case "customer.subscription.deleted":
      await endStripeSubscription(data);
      return;
    default:
      return;
  }
}

// ------------------------------------------------------------------ Paystack

/**
 * A successful Paystack charge (from its webhook, or the return page): what
 * was paid must match what was asked, in the charging currency, before
 * anything is added.
 */
export async function applyPaystack(tx: PaystackTransaction | Json): Promise<boolean> {
  const t = obj(tx);
  if (t.status !== "success") return false;
  let meta = t.metadata as Json | string | null;
  if (typeof meta === "string") {
    try {
      meta = JSON.parse(meta) as Json;
    } catch {
      meta = null;
    }
  }
  const m = obj(meta);
  const owner = str(m.owner);
  const kind = m.kind === "pro" ? "pro" : m.kind === "topup" ? "topup" : null;
  const amountUsd = Number(m.amount_usd);
  if (!owner || !OWNER.test(owner) || !kind || !(amountUsd > 0)) return false;
  const config = billingConfig();
  const currency = String(t.currency ?? "").toUpperCase();
  const expected = paystackMinor(amountUsd, currency, config.paystackRate);
  // Paid in the currency it was asked in, and in full (a cent of rounding
  // aside): a doctored amount buys nothing.
  if (currency !== config.paystackCurrency || Number(t.amount) + 1 < expected) return false;
  return applyPayment({
    owner,
    provider: "paystack",
    ref: String(t.reference),
    kind,
    amountUsd,
    currency,
    amountMinor: Number(t.amount),
    billing: kind === "pro" ? "pass" : undefined,
  });
}

export async function handlePaystackEvent(event: Json): Promise<void> {
  if (event.event === "charge.success") await applyPaystack(obj(event.data));
}
