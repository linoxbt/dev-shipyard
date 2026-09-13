import { createFileRoute, redirect } from "@tanstack/react-router";

// Templates are part of the Marketplace now: built-in templates are listed
// there as official, free listings next to everything builders sell. The route
// stays as a redirect because it has been linked to.

export const Route = createFileRoute("/launchkit/templates/")({
  beforeLoad: () => {
    throw redirect({ to: "/launchkit/marketplace", search: { kind: "template" }, replace: true });
  },
});
