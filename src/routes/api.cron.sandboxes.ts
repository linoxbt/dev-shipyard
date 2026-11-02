import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { sandboxHostEnabled, sweepSandboxes } from "@/lib/orchestrator/sandbox.server";

// Daily clean-up of abandoned project sandboxes (vercel.json "crons"). Vercel
// calls it with Authorization: Bearer $CRON_SECRET; without that variable set,
// nothing is deleted.

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length < 16) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export const Route = createFileRoute("/api/cron/sandboxes")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorised(request)) return Response.json({ ok: false }, { status: 401 });
        if (!sandboxHostEnabled())
          return Response.json({ ok: true, skipped: "not using Vercel Sandbox" });
        try {
          return Response.json({ ok: true, ...(await sweepSandboxes()) });
        } catch (error) {
          console.error("sandbox sweep failed", error);
          return Response.json({ ok: false }, { status: 502 });
        }
      },
    },
  },
});
