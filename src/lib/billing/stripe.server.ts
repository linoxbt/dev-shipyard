import { createHmac, timingSafeEqual } from "node:crypto";

// Stripe, over its plain HTTP API (no SDK): Checkout for top-ups and the Pro
// subscription, the customer portal for managing it, and the check that a
// webhook really came from Stripe. STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
// turn it on (lib/billing/config.server.ts).

const API = "https://api.stripe.com/v1";

/** Stripe's form encoding, nested keys included (line_items[0][price_data][…]). */
export function formEncode(
  value: unknown,
  prefix = "",
  out = new URLSearchParams(),
): URLSearchParams {
  if (value === undefined || value === null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => formEncode(v, `${prefix}[${i}]`, out));
  } else if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      formEncode(v, prefix ? `${prefix}[${k}]` : k, out);
    }
  } else {
    out.append(prefix, String(value));
  }
  return out;
}

async function stripe<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "POST",
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY ?? ""}`,
      "content-type": "application/x-www-form-urlencoded",
      "stripe-version": "2024-06-20",
    },
    body: init.body ? formEncode(init.body).toString() : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(data?.error?.message ?? `Stripe answered ${res.status}.`);
  return data;
}

export interface CheckoutInput {
  owner: string;
  email: string | null;
  kind: "topup" | "pro";
  amountUsd: number;
  successUrl: string;
  cancelUrl: string;
  /** The account's Stripe customer, when it has one (so Pro reuses it). */
  customer?: string | null;
}

/** A Checkout page for a top-up (one payment) or Pro (a monthly subscription). */
export async function stripeCheckout(
  input: CheckoutInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  const cents = Math.round(input.amountUsd * 100);
  const metadata = { owner: input.owner, kind: input.kind, amount_usd: input.amountUsd.toFixed(2) };
  const common = {
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.owner,
    metadata,
    ...(input.customer
      ? { customer: input.customer }
      : input.email
        ? { customer_email: input.email }
        : {}),
    allow_promotion_codes: "true",
  };
  const session =
    input.kind === "topup"
      ? await stripe<{ url: string }>(
          "/checkout/sessions",
          {
            body: {
              ...common,
              mode: "payment",
              ...(input.customer ? {} : { customer_creation: "always" }),
              payment_intent_data: { metadata },
              line_items: [
                {
                  quantity: 1,
                  price_data: {
                    currency: "usd",
                    unit_amount: cents,
                    product_data: {
                      name: `DevStation credit: $${input.amountUsd.toFixed(2)}`,
                      description: "Prepaid credit for AI models on DevStation.",
                    },
                  },
                },
              ],
            },
          },
          env,
        )
      : await stripe<{ url: string }>(
          "/checkout/sessions",
          {
            body: {
              ...common,
              mode: "subscription",
              subscription_data: { metadata },
              line_items: [
                env.STRIPE_PRO_PRICE_ID
                  ? { quantity: 1, price: env.STRIPE_PRO_PRICE_ID }
                  : {
                      quantity: 1,
                      price_data: {
                        currency: "usd",
                        unit_amount: cents,
                        recurring: { interval: "month" },
                        product_data: {
                          name: "DevStation Pro",
                          description:
                            "Every model, included monthly credit and a larger free allowance.",
                        },
                      },
                    },
              ],
            },
          },
          env,
        );
  return session.url;
}

/** The page where a customer manages or cancels their subscription. */
export async function stripePortal(customer: string, returnUrl: string): Promise<string> {
  const portal = await stripe<{ url: string }>("/billing_portal/sessions", {
    body: { customer, return_url: returnUrl },
  });
  return portal.url;
}

export interface StripeSession {
  id: string;
  mode: "payment" | "subscription";
  payment_status: "paid" | "unpaid" | "no_payment_required";
  amount_total: number | null;
  currency: string | null;
  customer: string | null;
  metadata: Record<string, string> | null;
}

export function stripeSession(id: string): Promise<StripeSession> {
  return stripe<StripeSession>(`/checkout/sessions/${encodeURIComponent(id)}`, { method: "GET" });
}

/**
 * Whether a webhook body was signed by Stripe with this endpoint's secret
 * (the Stripe-Signature header: t=<time>,v1=<hmac>), and recently: a replay
 * of an old event is refused.
 */
export function stripeSignatureValid(
  body: string,
  header: string | null,
  secret: string,
  now = Date.now(),
  toleranceSec = 300,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!Number.isFinite(t) || !signatures.length) return false;
  if (Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${body}`).digest();
  return signatures.some((sig) => {
    const got = Buffer.from(sig, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}
