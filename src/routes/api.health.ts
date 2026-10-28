import { createFileRoute } from "@tanstack/react-router";
import { readiness } from "@/lib/health.server";

// Readiness for monitors and deploy gates: 200 when everything production
// needs is in place, 503 with the failing checks otherwise. Reports only
// whether settings are present, never their values.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const health = await readiness();
        return Response.json(health, {
          status: health.ok ? 200 : 503,
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
