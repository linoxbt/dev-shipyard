import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import { grantedOwner, toAccounts } from "@/lib/accounts.server";

// What the connected wallet is linked to: one GitHub account, one verified
// email. A thin proxy in front of the runner's /account, for the same reason as
// /api/publish: the runner's token must never reach a browser.
//
// The wallet is always the one that signed the grant, never a value from the
// body, so knowing somebody's address does nothing here.

const READ_LIMIT = 300;
const WRITE_LIMIT = 40;
const WINDOW_MS = 60 * 60 * 1000;

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

const NO_GRANT = [
  "no_grant",
  "Connect a wallet and sign once to manage your account. It costs no gas.",
  401,
] as const;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("unlink_github") }),
  z.object({ action: z.literal("email_start"), email: z.string().min(3).max(254) }),
  z.object({ action: z.literal("email_verify"), code: z.string().min(4).max(10) }),
  z.object({ action: z.literal("unlink_email") }),
]);

export const Route = createFileRoute("/api/account")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = grantedOwner(request);
        if (!owner) return fail(...NO_GRANT);
        const caller = clientKeyFromRequest(request);
        if (!checkRateLimit(`account:read:${caller}`, READ_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const result = await toAccounts("/account", { method: "GET" }, owner, caller);
        if (!result) return fail("unreachable", "Accounts are unavailable right now.", 502);
        return Response.json(result.body, { status: result.status });
      },

      POST: async ({ request }) => {
        const owner = grantedOwner(request);
        if (!owner) return fail(...NO_GRANT);
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const caller = clientKeyFromRequest(request);
        if (!checkRateLimit(`account:write:${caller}`, WRITE_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many requests. Try again later.", 429);
        }
        const data = parsed.data;

        const call =
          data.action === "unlink_github"
            ? (["/account/github", { method: "DELETE" }] as const)
            : data.action === "unlink_email"
              ? (["/account/email", { method: "DELETE" }] as const)
              : data.action === "email_start"
                ? ([
                    "/account/email/start",
                    { method: "POST", body: JSON.stringify({ email: data.email }) },
                  ] as const)
                : ([
                    "/account/email/verify",
                    { method: "POST", body: JSON.stringify({ code: data.code }) },
                  ] as const);

        const result = await toAccounts(call[0], call[1], owner, caller);
        if (!result) return fail("unreachable", "Accounts are unavailable right now.", 502);
        return Response.json(result.body, { status: result.status });
      },
    },
  },
});
