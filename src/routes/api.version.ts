import { createFileRoute } from "@tanstack/react-router";

// Which build is deployed, so a tab left open across a deploy can tell it is
// running old code and load the new one (lib/use-update-check.ts).
export const Route = createFileRoute("/api/version")({
  server: {
    handlers: {
      GET: () =>
        Response.json({ build: __APP_VERSION__ }, { headers: { "cache-control": "no-store" } }),
    },
  },
});
