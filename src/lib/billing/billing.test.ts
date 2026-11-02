import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { billingConfig, publicBillingConfig } from "./config.server";
import { formEncode, stripeSignatureValid } from "./stripe.server";
import { paystackMinor, paystackSignatureValid } from "./paystack.server";
import { chargeFor, type Access } from "@/lib/db/access.server";

const OWNER = `0x${"b".repeat(40)}`;

const access = (patch: Partial<Access> = {}): Access => ({
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
  freeDailyUsd: 0.5,
  available: true,
  ...patch,
});

describe("the economics", () => {
  it("has sound defaults, each one changeable without code", () => {
    const d = billingConfig({});
    expect(d).toMatchObject({
      markup: 1.25,
      freeDailyUsd: 0.5,
      proFreeDailyUsd: 5,
      proPriceUsd: 20,
      proIncludedUsd: 20,
      providers: [],
    });
    const c = billingConfig({
      BILLING_MARKUP: "1.4",
      FREE_DAILY_USD: "unlimited",
      PRO_PRICE_USD: "29",
      STRIPE_SECRET_KEY: "sk",
      STRIPE_WEBHOOK_SECRET: "whsec",
      PAYSTACK_SECRET_KEY: "psk",
    });
    expect(c.markup).toBe(1.4);
    expect(c.freeDailyUsd).toBeNull();
    expect(c.proPriceUsd).toBe(29);
    expect(c.providers).toEqual(["stripe", "paystack"]);
    // A margin below cost would lose money on every call: never under 1.
    expect(billingConfig({ BILLING_MARKUP: "0.5" }).markup).toBe(1);
  });

  it("offers Paystack in a local currency only when it has the rate", () => {
    const env = { PAYSTACK_SECRET_KEY: "psk", PAYSTACK_CURRENCY: "NGN" };
    expect(publicBillingConfig(env).providers).toEqual([]);
    expect(publicBillingConfig({ ...env, PAYSTACK_USD_RATE: "1600" }).providers).toEqual([
      "paystack",
    ]);
    expect(paystackMinor(10, "NGN", 1600)).toBe(1_600_000);
    expect(paystackMinor(10, "USD", 1)).toBe(1000);
  });

  it("decides who pays for each call", () => {
    // The free model, within today's allowance: free.
    expect(chargeFor(access(), "auto")).toEqual({ pay: "free" });
    // Past it: from credit, or refused without credit.
    expect(chargeFor(access({ freeUsedToday: 0.6, balance: 3 }), "auto")).toEqual({
      pay: "credit",
    });
    expect(chargeFor(access({ freeUsedToday: 0.6 }), "auto")).toHaveProperty("refused");
    // Premium models: always from credit.
    expect(chargeFor(access({ balance: 2 }), "opus-5.5")).toEqual({ pay: "credit" });
    expect(chargeFor(access(), "opus-5.5")).toHaveProperty("refused");
    // Pro granted by an admin: never charged.
    expect(chargeFor(access({ plan: "pro", unlimited: true }), "opus-5.5")).toEqual({
      pay: "free",
    });
    // No limit set: the free model is free all day.
    expect(chargeFor(access({ freeDailyUsd: null, freeUsedToday: 99 }), "auto")).toEqual({
      pay: "free",
    });
  });
});

describe("gateway signatures", () => {
  it("accepts only a recent Stripe signature over the exact body", () => {
    const body = '{"type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_x").update(`${t}.${body}`).digest("hex");
    expect(stripeSignatureValid(body, `t=${t},v1=${sig}`, "whsec_x")).toBe(true);
    expect(stripeSignatureValid(`${body} `, `t=${t},v1=${sig}`, "whsec_x")).toBe(false);
    expect(stripeSignatureValid(body, `t=${t},v1=${sig}`, "whsec_other")).toBe(false);
    // A replay of an old event.
    expect(stripeSignatureValid(body, `t=${t},v1=${sig}`, "whsec_x", (t + 3600) * 1000)).toBe(
      false,
    );
    expect(stripeSignatureValid(body, null, "whsec_x")).toBe(false);
  });

  it("accepts only Paystack's HMAC-SHA512 of the body", () => {
    const body = '{"event":"charge.success"}';
    const sig = createHmac("sha512", "sk_live_x").update(body).digest("hex");
    expect(paystackSignatureValid(body, sig, "sk_live_x")).toBe(true);
    expect(paystackSignatureValid(body, sig, "sk_live_y")).toBe(false);
    expect(paystackSignatureValid(body, "00", "sk_live_x")).toBe(false);
  });

  it("encodes Stripe's nested form fields", () => {
    const f = formEncode({
      mode: "payment",
      metadata: { owner: OWNER },
      line_items: [{ quantity: 1, price_data: { unit_amount: 2500 } }],
    });
    expect(f.get("metadata[owner]")).toBe(OWNER);
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe("2500");
  });
});

// Payments against a stand-in database: what reaches apply_payment, once.
describe("payments becoming credit and Pro", () => {
  let db: ReturnType<typeof Bun.serve>;
  const applied: Record<string, unknown>[] = [];
  const saved: Record<string, string | undefined> = {};
  const keys = [
    "VITE_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PAYSTACK_SECRET_KEY",
    "PAYSTACK_CURRENCY",
  ];

  beforeAll(() => {
    db = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        if (url.pathname.endsWith("/rpc/apply_payment")) {
          const again = applied.some((a) => a.p_ref === body.p_ref);
          applied.push(body);
          return Response.json(!again);
        }
        return Response.json([]);
      },
    });
    for (const k of keys) saved[k] = process.env[k];
    process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${db.port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    process.env.PAYSTACK_SECRET_KEY = "sk_test_paystack";
    process.env.PAYSTACK_CURRENCY = "USD";
  });

  afterAll(() => {
    db.stop(true);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  async function webhook(route: "stripe" | "paystack", event: unknown, sign = true) {
    const body = JSON.stringify(event);
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (sign && route === "stripe") {
      const t = Math.floor(Date.now() / 1000);
      headers["stripe-signature"] =
        `t=${t},v1=${createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex")}`;
    }
    if (sign && route === "paystack") {
      headers["x-paystack-signature"] = createHmac("sha512", "sk_test_paystack")
        .update(body)
        .digest("hex");
    }
    const mod =
      route === "stripe"
        ? await import("@/routes/api.payments.stripe")
        : await import("@/routes/api.payments.paystack");
    const post = (
      mod.Route.options as unknown as {
        server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
      }
    ).server.handlers.POST;
    return post({
      request: new Request(`https://site.test/api/payments/${route}`, {
        method: "POST",
        headers,
        body,
      }),
    });
  }

  it("refuses an unsigned webhook and applies nothing", async () => {
    applied.length = 0;
    const res = await webhook("stripe", { type: "checkout.session.completed" }, false);
    expect(res.status).toBe(400);
    expect(applied).toEqual([]);
  });

  it("turns a paid Stripe top-up into credit, once however often it is delivered", async () => {
    applied.length = 0;
    const event = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_1",
          mode: "payment",
          payment_status: "paid",
          amount_total: 2500,
          currency: "usd",
          customer: "cus_1",
          metadata: { owner: OWNER, kind: "topup" },
        },
      },
    };
    expect((await webhook("stripe", event)).status).toBe(200);
    expect((await webhook("stripe", event)).status).toBe(200);
    expect(applied[0]).toMatchObject({
      p_owner: OWNER,
      p_provider: "stripe",
      p_ref: "cs_test_1",
      p_kind: "topup",
      p_amount: 25,
    });
  });

  it("turns a paid Stripe invoice into Pro until the period ends, in either invoice shape", async () => {
    applied.length = 0;
    const end = Math.floor(Date.now() / 1000) + 30 * 86_400;
    await webhook("stripe", {
      type: "invoice.paid",
      data: {
        object: {
          id: "in_1",
          amount_paid: 2000,
          currency: "usd",
          customer: "cus_1",
          subscription: "sub_1",
          subscription_details: { metadata: { owner: OWNER, kind: "pro" } },
          lines: { data: [{ period: { end } }] },
        },
      },
    });
    await webhook("stripe", {
      type: "invoice.paid",
      data: {
        object: {
          id: "in_2",
          amount_paid: 2000,
          currency: "usd",
          customer: "cus_1",
          parent: {
            subscription_details: {
              subscription: "sub_1",
              metadata: { owner: OWNER, kind: "pro" },
            },
          },
          lines: { data: [{ period: { end } }] },
        },
      },
    });
    expect(applied.map((a) => [a.p_ref, a.p_kind, a.p_billing, a.p_subscription])).toEqual([
      ["in_1", "pro", "subscription", "sub_1"],
      ["in_2", "pro", "subscription", "sub_1"],
    ]);
    expect(applied[0].p_included).toBe(20);
    expect(applied[0].p_period_end).toBe(new Date(end * 1000).toISOString());
  });

  it("applies a Paystack charge only when it was paid in full, in the currency asked", async () => {
    applied.length = 0;
    const charge = (patch: Record<string, unknown>) => ({
      event: "charge.success",
      data: {
        reference: "ds_topup_1",
        status: "success",
        amount: 1000,
        currency: "USD",
        metadata: { owner: OWNER, kind: "topup", amount_usd: "10.00" },
        ...patch,
      },
    });
    await webhook("paystack", charge({ amount: 500 })); // underpaid
    await webhook("paystack", charge({ currency: "NGN" })); // another currency
    expect(applied).toEqual([]);
    await webhook("paystack", charge({}));
    expect(applied[0]).toMatchObject({ p_provider: "paystack", p_kind: "topup", p_amount: 10 });
    // A pass for Pro: 30 days, no end date given.
    await webhook(
      "paystack",
      charge({
        reference: "ds_pro_1",
        amount: 2000,
        metadata: { owner: OWNER, kind: "pro", amount_usd: "20.00" },
      }),
    );
    expect(applied[1]).toMatchObject({ p_kind: "pro", p_billing: "pass", p_period_end: null });
  });
});
