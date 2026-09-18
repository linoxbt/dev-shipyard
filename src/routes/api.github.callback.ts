import { createFileRoute } from "@tanstack/react-router";
import {
  COOKIE_NAME,
  STATE_COOKIE_NAME,
  RETURN_COOKIE_NAME,
  callbackUrl,
  clearedCookie,
  githubConfig,
  readCookie,
  safeReturnPath,
  sealSession,
  stateValid,
} from "@/lib/github-oauth.server";
import { githubUser, grantedOwner, toAccounts } from "@/lib/accounts.server";
import { clientKeyFromRequest } from "@/lib/rateLimit.server";

// Where GitHub sends the user back. Exchanges the code for a token, stores it
// in an httpOnly cookie, and returns to the page they started from.

export const Route = createFileRoute("/api/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secure = url.protocol === "https:";
        const returnTo =
          safeReturnPath(readCookie(request.headers.get("cookie"), RETURN_COOKIE_NAME)) ??
          "/launchkit/apps";
        const withParam = (msg: string) =>
          `${returnTo}${returnTo.includes("?") ? "&" : "?"}github=${encodeURIComponent(msg)}`;
        const back = (msg?: string) =>
          new Response(null, {
            status: 302,
            headers: [
              ["location", msg ? withParam(msg) : returnTo],
              ["set-cookie", clearedCookie(STATE_COOKIE_NAME, secure)],
              ["set-cookie", clearedCookie(RETURN_COOKIE_NAME, secure)],
            ],
          });

        const cfg = githubConfig();
        if (!cfg.configured) return back("not_configured");

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const cookieState = readCookie(request.headers.get("cookie"), STATE_COOKIE_NAME);

        // The state must be one WE issued and must match the cookie. Without
        // both checks an attacker could complete a login of their choosing in
        // the victim's browser and have their own repositories pushed to.
        if (!code || !state || state !== cookieState || !stateValid(state)) {
          return back("bad_state");
        }

        const res = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            client_id: cfg.clientId,
            client_secret: cfg.clientSecret,
            code,
            redirect_uri: callbackUrl(request),
          }),
        }).catch(() => null);
        if (!res || !res.ok) return back("exchange_failed");

        const body = (await res.json().catch(() => null)) as {
          access_token?: string;
          error?: string;
        } | null;
        if (!body?.access_token) return back(body?.error || "no_token");

        // A GitHub account belongs to one wallet, and a wallet to one GitHub
        // account. This redirect is the one place where both are known: the
        // claim cookie rides back from GitHub with it.
        const owner = grantedOwner(request);
        if (!owner) return back("connect_wallet");
        const user = await githubUser(body.access_token);
        if (!user) return back("no_account");
        const linked = await toAccounts(
          "/account/github",
          { method: "POST", body: JSON.stringify({ id: user.id, login: user.login }) },
          owner,
          clientKeyFromRequest(request),
        );
        if (!linked) return back("unreachable");
        // Refused: no session cookie either, so the browser is not left signed
        // in to an account this wallet may not use.
        if (!linked.ok) return back(String(linked.body.error ?? "link_failed"));

        return new Response(null, {
          status: 302,
          headers: [
            ["location", withParam("connected")],
            [
              "set-cookie",
              `${COOKIE_NAME}=${encodeURIComponent(sealSession(body.access_token))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
                30 * 24 * 60 * 60
              }${secure ? "; Secure" : ""}`,
            ],
            ["set-cookie", clearedCookie(STATE_COOKIE_NAME, secure)],
            ["set-cookie", clearedCookie(RETURN_COOKIE_NAME, secure)],
          ],
        });
      },
    },
  },
});
