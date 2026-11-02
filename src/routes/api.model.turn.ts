import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { recordTurnRow } from "@/lib/db/turns.server";
import { passFromRequest } from "@/lib/db/turn-token.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// A sandbox reports a finished turn here, with that turn's pass, so every turn
// is in the site's records whether or not anyone's browser was watching. The
// pass says who sent it; the figures are for the stats only (spend is metered
// per model call in routes/api.model.ts, never taken from this report).

const body = z.object({
  workspace: z.string().min(1).max(120),
  turn: z.number().int().min(1).max(1_000_000),
  phase: z.enum(["idle", "error", "cancelled"]),
  steps: z.number().min(0).max(10_000),
  costUsd: z.number().min(0).max(10_000),
  changed: z.number().min(0).max(100_000),
  plan: z.boolean(),
});

export const Route = createFileRoute("/api/model/turn")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const pass = passFromRequest(request);
        if (!pass) return Response.json({ ok: false }, { status: 401 });
        if (!(await checkRateLimit(`model-turn:${pass.owner}`, 120, 10 * 60_000))) {
          return Response.json({ ok: false }, { status: 429 });
        }
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ ok: false }, { status: 400 });
        await recordTurnRow({ owner: pass.owner, model: pass.model, ...parsed.data });
        return Response.json({ ok: true });
      },
    },
  },
});
