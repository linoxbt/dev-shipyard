import { createFileRoute, redirect } from "@tanstack/react-router";

// Submitting a template is selling one now: the Sell page lists it on-chain,
// where other people can find it, rather than saving it in this browser only.

export const Route = createFileRoute("/launchkit/templates/submit")({
  beforeLoad: () => {
    throw redirect({ to: "/launchkit/marketplace/sell", replace: true });
  },
});
