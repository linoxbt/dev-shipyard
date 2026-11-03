import { createFileRoute } from "@tanstack/react-router";
import { passFromRequest, renewTurnPass } from "@/lib/db/turn-token.server";
import { refuseNonMember } from "@/lib/access/members.server";
import { keepSandboxAwake } from "@/lib/orchestrator/sandbox.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// A project's machine checks in here every few minutes while its agent has
// work (a turn running, or messages waiting their turn), with the pass of
// that work. It gets a renewed pass, and the machine is kept up: the agent
// goes on with nobody watching, the way a person leaves it working and comes
// back later. A renewed pass keeps its first start, so this ends after
// MAX_RENEWED_MS whatever happens.

export const Route = createFileRoute("/api/model/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const pass = passFromRequest(request);
        if (!pass) return Response.json({ ok: false, reason: "expired" }, { status: 401 });
        // No renewal for an account whose access was taken away.
        if (await refuseNonMember(pass.owner)) {
          return Response.json({ ok: false, reason: "expired" }, { status: 401 });
        }
        if (!(await checkRateLimit(`model-heartbeat:${pass.owner}`, 240, 10 * 60_000))) {
          return Response.json({ ok: false, reason: "rate_limited" }, { status: 429 });
        }
        const token = renewTurnPass(pass);
        if (!token) {
          return Response.json(
            { ok: false, reason: "too_long", message: "This work has run for as long as it may." },
            { status: 403 },
          );
        }
        const awake = pass.workspace ? await keepSandboxAwake(pass.workspace) : false;
        return Response.json({ ok: true, token, awake });
      },
    },
  },
});
