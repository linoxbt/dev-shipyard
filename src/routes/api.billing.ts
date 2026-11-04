import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { billingConfig, publicBillingConfig } from "@/lib/billing/config.server";
import { fallbackSettings, usageSettings } from "@/lib/billing/limits.server";
import { applyPaystack, applyStripeSession } from "@/lib/billing/ledger.server";
import { paystackCheckout, paystackVerify } from "@/lib/billing/paystack.server";
import { stripeCheckout, stripePortal, stripeSession } from "@/lib/billing/stripe.server";
import { dbConfigured, select } from "@/lib/db/admin.server";
import { fail, requestEmail, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// Buying credit and Pro (routes/credits.tsx):
//
// GET                         the prices, plans and which gateways are on
// POST {action: "checkout"}   a payment page: a top-up or Pro, on Stripe or Paystack
// POST {action: "portal"}     Stripe's page for managing a subscription
// POST {action: "confirm"}    the browser is back from paying: apply it now
//                             if the webhook has not yet (it is applied once)

const body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("checkout"),
    kind: z.enum(["topup", "pro"]),
    provider: z.enum(["stripe", "paystack"]),
    amount: z.number().positive().max(100_000).optional(),
  }),
  z.object({ action: z.literal("portal") }),
  z.object({
    action: z.literal("confirm"),
    provider: z.enum(["stripe", "paystack"]),
    id: z.string().min(4).max(200),
  }),
]);

export const Route = createFileRoute("/api/billing")({
  server: {
    handlers: {
      GET: async () => {
        // The free allowance and the limits are the admin's settings.
        const settings = dbConfigured() ? await usageSettings() : fallbackSettings();
        return Response.json(
          {
            ok: true,
            ...publicBillingConfig(),
            freeDailyUsd: settings.freeDailyUsd,
            launchCreditUsd: settings.launchCreditUsd,
            runLimitUsd: settings.runLimitUsd,
            dailyLimitUsd: settings.dailyLimitUsd,
            runsPerDay: settings.runsPerDay,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Payments are not set up yet.", 503);
        if (!(await checkRateLimit(`billing:${owner}`, 30, 10 * 60_000))) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const data = parsed.data;
        const config = billingConfig();
        const origin = new URL(request.url).origin;
        const plan = async () =>
          (
            await select<{ stripe_customer: string | null }>(
              "account_plans",
              `select=stripe_customer&owner=eq.${encodeURIComponent(owner)}`,
            )
          )[0] ?? null;

        try {
          if (data.action === "checkout") {
            if (!publicBillingConfig().providers.includes(data.provider)) {
              return fail("unavailable", "That way of paying is not set up yet.", 400);
            }
            const amountUsd =
              data.kind === "pro" ? config.proPriceUsd : Math.round((data.amount ?? 0) * 100) / 100;
            if (
              data.kind === "topup" &&
              (amountUsd < config.minTopUpUsd || amountUsd > config.maxTopUpUsd)
            ) {
              return fail(
                "invalid_amount",
                `Add between $${config.minTopUpUsd} and $${config.maxTopUpUsd}.`,
                400,
              );
            }
            const email = requestEmail(request);
            if (data.provider === "stripe") {
              const url = await stripeCheckout({
                owner,
                email,
                kind: data.kind,
                amountUsd,
                customer: (await plan())?.stripe_customer ?? null,
                successUrl: `${origin}/credits?paid=stripe&session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: `${origin}/credits?cancelled=1`,
              });
              return Response.json({ ok: true, url });
            }
            if (!email) return fail("no_email", "Sign in again so the receipt has an email.", 400);
            const { url } = await paystackCheckout({
              owner,
              email,
              kind: data.kind,
              amountUsd,
              currency: config.paystackCurrency,
              rate: config.paystackRate,
              callbackUrl: `${origin}/credits?paid=paystack`,
            });
            return Response.json({ ok: true, url });
          }

          if (data.action === "portal") {
            const customer = (await plan())?.stripe_customer;
            if (!customer || !config.providers.includes("stripe")) {
              return fail("no_customer", "There is no subscription to manage.", 404);
            }
            return Response.json({
              ok: true,
              url: await stripePortal(customer, `${origin}/credits`),
            });
          }

          // confirm: only for this account's own payment.
          if (data.provider === "stripe") {
            const session = await stripeSession(data.id);
            if (session.metadata?.owner !== owner) {
              return fail("not_yours", "That payment is not this account's.", 403);
            }
            const applied = await applyStripeSession(session);
            return Response.json({
              ok: true,
              paid: session.payment_status === "paid",
              applied,
              kind: session.metadata?.kind ?? null,
            });
          }
          const tx = await paystackVerify(data.id);
          const meta =
            typeof tx.metadata === "string"
              ? (JSON.parse(tx.metadata) as { owner?: string })
              : (tx.metadata ?? {});
          if (meta.owner !== owner)
            return fail("not_yours", "That payment is not this account's.", 403);
          const applied = await applyPaystack(tx);
          return Response.json({ ok: true, paid: tx.status === "success", applied });
        } catch (error) {
          console.error("billing", error);
          return fail(
            "gateway",
            "The payment service could not be reached just now. Nothing was charged; try again in a moment.",
            502,
          );
        }
      },
    },
  },
});
