import { createFileRoute } from "@tanstack/react-router";
import {
  COOKIE_NAME,
  STATE_COOKIE_NAME,
  callbackUrl,
  clearedCookie,
  githubConfig,
  newState,
  openSession,
  readCookie,
  stateCookie,
} from "@/lib/github-oauth.server";

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
          return new Response(null, {
            status: 302,
            headers: {
              location: authorize.toString(),
              "set-cookie": stateCookie(state, secureFor(request)),
            },
          });
        }

        if (!cfg.configured) return Response.json({ configured: false, user: null });

        const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
        if (!token) return Response.json({ configured: true, user: null });

        const res = await fetch("https://api.github.com/user", {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
          },
        }).catch(() => null);
        if (!res || !res.ok) {
          // The token was revoked on GitHub's side. Drop the cookie rather than
          // leaving the UI claiming a connection that no longer works.
          return new Response(JSON.stringify({ configured: true, user: null }), {
            headers: {
              "content-type": "application/json",
              "set-cookie": clearedCookie(COOKIE_NAME, secureFor(request)),
            },
          });
        }
        const u = (await res.json()) as { login: string; avatar_url: string; name?: string };
        return Response.json({
          configured: true,
          user: { login: u.login, avatarUrl: u.avatar_url, name: u.name ?? null },
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
