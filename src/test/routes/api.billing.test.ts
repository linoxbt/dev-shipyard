import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { claimCookieHeader, withOwner } from "@/lib/agent-access/claims.server";

// Opening a payment page: the amount is checked, and Stripe is asked for the
// right thing (Stripe and the database are stand-ins).

const OWNER = `0x${"c".repeat(40)}`;
let db: ReturnType<typeof Bun.serve>;
const realFetch = globalThis.fetch;
const sentToStripe: URLSearchParams[] = [];
const saved: Record<string, string | undefined> = {};
const keys = [
  "SESSION_SECRET",
  "VITE_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

beforeAll(() => {
  db = Bun.serve({ port: 0, fetch: () => Response.json([]) });
  for (const k of keys) saved[k] = process.env[k];
  process.env.SESSION_SECRET = "test-secret-for-billing";
  process.env.VITE_SUPABASE_URL = `http://127.0.0.1:${db.port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
  process.env.STRIPE_SECRET_KEY = "sk_test_x";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.stripe.com/")) {
      sentToStripe.push(new URLSearchParams(String(init?.body ?? "")));
      return Response.json({ url: "https://checkout.stripe.com/c/pay/cs_test_1" });
    }
    return realFetch(input as string, init);
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = realFetch;
  db.stop(true);
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

async function post(body: unknown, signedIn = true) {
  const { Route } = await import("@/routes/api.billing");
  const handler = (
    Route.options as unknown as {
      server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
    }
  ).server.handlers.POST;
  return handler({
    request: new Request("https://devstation.test/api/billing", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(signedIn ? { cookie: claimCookieHeader(withOwner(null, OWNER)).split(";")[0] } : {}),
      },
      body: JSON.stringify(body),
    }),
  });
}

describe("/api/billing", () => {
  it("needs a signed-in account", async () => {
    expect(
      (await post({ action: "checkout", kind: "topup", provider: "stripe", amount: 10 }, false))
        .status,
    ).toBe(401);
  });

  it("refuses an amount outside what can be added", async () => {
    expect(
      (await post({ action: "checkout", kind: "topup", provider: "stripe", amount: 2 })).status,
    ).toBe(400);
    expect(
      (await post({ action: "checkout", kind: "topup", provider: "stripe", amount: 5000 })).status,
    ).toBe(400);
    // Not set up: refused, not sent anywhere.
    expect(
      (await post({ action: "checkout", kind: "topup", provider: "paystack", amount: 10 })).status,
    ).toBe(400);
  });

  it("opens Stripe Checkout for this account's top-up, and for Pro as a subscription", async () => {
    sentToStripe.length = 0;
    const res = await post({ action: "checkout", kind: "topup", provider: "stripe", amount: 25 });
    expect(await res.json()).toMatchObject({
      ok: true,
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
    });
    const topup = sentToStripe[0];
    expect(topup.get("mode")).toBe("payment");
    expect(topup.get("line_items[0][price_data][unit_amount]")).toBe("2500");
    expect(topup.get("metadata[owner]")).toBe(OWNER);
    expect(topup.get("metadata[kind]")).toBe("topup");
    expect(topup.get("success_url")).toContain(
      "/credits?paid=stripe&session_id={CHECKOUT_SESSION_ID}",
    );

    await post({ action: "checkout", kind: "pro", provider: "stripe" });
    const pro = sentToStripe[1];
    expect(pro.get("mode")).toBe("subscription");
    expect(pro.get("line_items[0][price_data][recurring][interval]")).toBe("month");
    expect(pro.get("subscription_data[metadata][owner]")).toBe(OWNER);
  });
});
