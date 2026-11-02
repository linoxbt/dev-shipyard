import { createFileRoute } from "@tanstack/react-router";
import { CLAIM_COOKIE, openClaims, readCookie } from "@/lib/agent-access/claims.server";

// Whether this browser holds DevStation's session.
//
// Sign-in is by email code only (routes/api.access.session.ts). The wallet
// signature sign-in this route used to accept is retired: it handed a full
// session to anyone who could sign with any key, with no email behind it.

export const Route = createFileRoute("/api/access")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const claims = openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
        return Response.json({ ok: true, granted: !!claims, owner: claims?.owner ?? null });
      },

      POST: () =>
        Response.json(
          {
            ok: false,
            reason: "gone",
            message: "Wallet sign-in has been retired. Sign in with your email instead.",
          },
          { status: 410 },
        ),
    },
  },
});
