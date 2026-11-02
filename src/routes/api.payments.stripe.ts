import { createFileRoute } from "@tanstack/react-router";
import { handleStripeEvent } from "@/lib/billing/ledger.server";
import { stripeSignatureValid } from "@/lib/billing/stripe.server";

// Stripe's webhook: point an endpoint at https://<site>/api/payments/stripe for
// checkout.session.completed, checkout.session.async_payment_succeeded,
// invoice.paid and customer.subscription.deleted, and put its signing secret
// in STRIPE_WEBHOOK_SECRET. Only events signed with that secret are read.

export const Route = createFileRoute("/api/payments/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
        const raw = await request.text();
        if (!stripeSignatureValid(raw, request.headers.get("stripe-signature"), secret)) {
          return Response.json({ ok: false }, { status: 400 });
        }
        try {
          await handleStripeEvent(JSON.parse(raw) as Record<string, unknown>);
          return Response.json({ ok: true });
        } catch (error) {
          // A 500 makes Stripe deliver it again later; applying is idempotent.
          console.error("stripe webhook", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
