import { createFileRoute, redirect } from "@tanstack/react-router";

// A template page is a marketplace listing now. Built-in ids keep working;
// anything else (an old browser-only draft) lands on the marketplace instead.

export const Route = createFileRoute("/launchkit/templates/$id")({
  beforeLoad: ({ params }) => {
    if (/^[a-z0-9-]{1,80}$/.test(params.id) && !params.id.startsWith("u-")) {
      throw redirect({
        to: "/launchkit/marketplace/$listingId",
        params: { listingId: `b-${params.id}` },
        replace: true,
      });
    }
    throw redirect({ to: "/launchkit/marketplace", search: { kind: "template" }, replace: true });
  },
});
