import { createFileRoute } from "@tanstack/react-router";
import {
  COOKIE_NAME,
  STATE_COOKIE_NAME,
  callbackUrl,
  clearedCookie,
  githubConfig,
  readCookie,
  sealSession,
  stateValid,
} from "@/lib/github-oauth.server";

// Where GitHub sends the user back. Exchanges the code for a token, stores it
// in an httpOnly cookie, and returns to the page they started from.

export const Route = createFileRoute("/api/github/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const secure = url.protocol === "https:";
        const back = (msg?: string) =>
          new Response(null, {
            status: 302,
            headers: [
              [
                "location",
                msg ? `/launchkit/apps?github=${encodeURIComponent(msg)}` : "/launchkit/apps",
              ],
              ["set-cookie", clearedCookie(STATE_COOKIE_NAME, secure)],
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

        return new Response(null, {
          status: 302,
          headers: [
            ["location", "/launchkit/apps?github=connected"],
            [
              "set-cookie",
              `${COOKIE_NAME}=${encodeURIComponent(sealSession(body.access_token))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
                30 * 24 * 60 * 60
              }${secure ? "; Secure" : ""}`,
            ],
            ["set-cookie", clearedCookie(STATE_COOKIE_NAME, secure)],
          ],
        });
      },
    },
  },
});
