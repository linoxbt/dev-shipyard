import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Paystack (cards, bank transfer and USSD across Africa): a payment page for
// a top-up or a 30-day Pro pass, the check that a webhook came from Paystack,
// and the lookup a returning browser triggers. PAYSTACK_SECRET_KEY turns it on;
// PAYSTACK_CURRENCY (default USD) with PAYSTACK_USD_RATE charges in a local
// currency (lib/billing/config.server.ts).

const API = "https://api.paystack.co";

async function paystack<T>(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "POST",
    headers: {
      authorization: `Bearer ${env.PAYSTACK_SECRET_KEY ?? ""}`,
      "content-type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => null)) as {
    status?: boolean;
    message?: string;
    data?: T;
  };
  if (!res.ok || !data?.status || !data.data) {
    throw new Error(data?.message ?? `Paystack answered ${res.status}.`);
  }
  return data.data;
}

/** Dollars in Paystack's smallest unit of the charging currency. */
export function paystackMinor(amountUsd: number, currency: string, rate: number): number {
  const local = currency === "USD" ? amountUsd : amountUsd * rate;
  return Math.round(local * 100);
}

export async function paystackCheckout(input: {
  owner: string;
  email: string;
  kind: "topup" | "pro";
  amountUsd: number;
  currency: string;
  rate: number;
  callbackUrl: string;
}): Promise<{ url: string; reference: string }> {
  const reference = `ds_${input.kind}_${randomBytes(9).toString("hex")}`;
  const data = await paystack<{ authorization_url: string; reference: string }>(
    "/transaction/initialize",
    {
      body: {
        email: input.email,
        amount: paystackMinor(input.amountUsd, input.currency, input.rate),
        currency: input.currency,
        reference,
        callback_url: input.callbackUrl,
        metadata: {
          owner: input.owner,
          kind: input.kind,
          amount_usd: input.amountUsd.toFixed(2),
          custom_fields: [
            {
              display_name: "Purchase",
              variable_name: "purchase",
              value: input.kind === "pro" ? "DevStation Pro (30 days)" : `DevStation credit`,
            },
          ],
        },
      },
    },
  );
  return { url: data.authorization_url, reference: data.reference };
}

export interface PaystackTransaction {
  reference: string;
  status: string;
  amount: number;
  currency: string;
  metadata: { owner?: string; kind?: string; amount_usd?: string } | string | null;
}

export function paystackVerify(reference: string): Promise<PaystackTransaction> {
  return paystack<PaystackTransaction>(`/transaction/verify/${encodeURIComponent(reference)}`, {
    method: "GET",
  });
}

/** Whether a webhook body was signed by Paystack (HMAC-SHA512 with the key). */
export function paystackSignatureValid(
  body: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header || !secret) return false;
  const expected = createHmac("sha512", secret).update(body).digest();
  const got = Buffer.from(header, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}
