import { createFileRoute } from "@tanstack/react-router";
import { handlePaystackEvent } from "@/lib/billing/ledger.server";
import { paystackSignatureValid } from "@/lib/billing/paystack.server";

// Paystack's webhook: set https://<site>/api/payments/paystack as the Webhook
// URL in the Paystack dashboard. Every event is signed with the secret key
// (x-paystack-signature); anything else is refused.

export const Route = createFileRoute("/api/payments/paystack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        const key = process.env.PAYSTACK_SECRET_KEY ?? "";
        if (!paystackSignatureValid(raw, request.headers.get("x-paystack-signature"), key)) {
          return Response.json({ ok: false }, { status: 400 });
        }
        try {
          await handlePaystackEvent(JSON.parse(raw) as Record<string, unknown>);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("paystack webhook", error);
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
