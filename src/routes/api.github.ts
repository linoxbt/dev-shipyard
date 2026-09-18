import { createFileRoute } from "@tanstack/react-router";
import {
  COOKIE_NAME,
  STATE_COOKIE_NAME,
  callbackUrl,
  returnCookie,
  safeReturnPath,
  clearedCookie,
  githubConfig,
  newState,
  openSession,
  readCookie,
  stateCookie,
} from "@/lib/github-oauth.server";
import { accountOf, githubUser, grantedOwner } from "@/lib/accounts.server";
import { clientKeyFromRequest } from "@/lib/rateLimit.server";

// GitHub sign-in status, start, and sign-out.
//
// GET  /api/github            -> { configured, user }
// GET  /api/github?start=1    -> 302 to GitHub's authorize page
// POST /api/github            -> sign out (clears the cookie)

function secureFor(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

export const Route = createFileRoute("/api/github")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const cfg = githubConfig();
        const url = new URL(request.url);

        if (url.searchParams.get("start")) {
          if (!cfg.configured) {
            return Response.json(
              { ok: false, message: "GitHub sign-in is not configured." },
              { status: 503 },
            );
          }
          const state = newState();
          const authorize = new URL("https://github.com/login/oauth/authorize");
          authorize.searchParams.set("client_id", cfg.clientId);
          authorize.searchParams.set("redirect_uri", callbackUrl(request));
          // `repo` is what allows creating a PRIVATE repository and pushing to
          // it. public_repo alone cannot create private ones, and this app
          // defaults new repositories to private.
          authorize.searchParams.set("scope", "repo");
          authorize.searchParams.set("state", state);
          const headers = new Headers({ location: authorize.toString() });
          headers.append("set-cookie", stateCookie(state, secureFor(request)));
          // Where to come back to: the Coding Agent asks for sign-in only when
          // someone pushes, and they should land back on their work.
          const back = safeReturnPath(url.searchParams.get("return"));
          if (back) headers.append("set-cookie", returnCookie(back, secureFor(request)));
          return new Response(null, { status: 302, headers });
        }

        if (!cfg.configured) return Response.json({ configured: false, user: null });

        const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
        if (!token) return Response.json({ configured: true, user: null });

        const user = await githubUser(token);
        if (!user) {
          // The token was revoked on GitHub's side. Drop the cookie rather than
          // leaving the UI claiming a connection that no longer works.
          return new Response(JSON.stringify({ configured: true, user: null }), {
            headers: {
              "content-type": "application/json",
              "set-cookie": clearedCookie(COOKIE_NAME, secureFor(request)),
            },
          });
        }

        // A GitHub session alone is not a connection any more: it counts when
        // the connected wallet is the one that linked this account.
        const owner = grantedOwner(request);
        const account = owner ? await accountOf(owner, clientKeyFromRequest(request)) : null;
        const linked = account?.github ?? null;
        return Response.json({
          configured: true,
          user: { login: user.login, avatarUrl: user.avatarUrl, name: user.name },
          link: {
            wallet: owner,
            linked: linked?.id === user.id,
            linkedLogin: linked?.login ?? null,
            /** Signed in as an account this wallet did not link. */
            mismatch: !!linked && linked.id !== user.id,
          },
        });
      },

      POST: async ({ request }) => {
        const secure = secureFor(request);
        return new Response(JSON.stringify({ ok: true }), {
          headers: [
            ["content-type", "application/json"],
            ["set-cookie", clearedCookie(COOKIE_NAME, secure)],
            ["set-cookie", clearedCookie(STATE_COOKIE_NAME, secure)],
          ],
        });
      },
    },
  },
});
