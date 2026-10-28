import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { readiness } from "@/lib/health.server";

// Readiness for monitors and deploy gates: 200 when everything production
// needs is in place, 503 otherwise. Reports only whether settings are
// present, never their values.
//
// The per-check breakdown says which defences are off (no shared limits, no
// runner), which is a map for an attacker, so the public answer is `ok`
// alone. Send `Authorization: Bearer $HEALTH_TOKEN` for the checks.

function authorised(request: Request): boolean {
  const token = process.env.HEALTH_TOKEN ?? "";
  if (token.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${token}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const health = await readiness();
        return Response.json(authorised(request) ? health : { ok: health.ok }, {
          status: health.ok ? 200 : 503,
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
