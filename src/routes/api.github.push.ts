import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { COOKIE_NAME, openSession, readCookie } from "@/lib/github-oauth.server";
import { pushApp, repoNameFrom } from "@/lib/github";

// Pushes an app to GitHub using the signed-in session.
//
// This runs on the server because the OAuth token lives in an httpOnly cookie
// and is deliberately unreadable from the page. The browser sends the files and
// the repo name; it never sees, and never needs, the token.

const FILES_LIMIT = 300;
const TOTAL_BYTES_LIMIT = 8 * 1024 * 1024;

const body = z.object({
  repoName: z.string().min(1).max(120),
  isPrivate: z.boolean().default(true),
  files: z.record(z.string(), z.string()),
  message: z.string().max(200).optional(),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

export const Route = createFileRoute("/api/github/push")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
        if (!token) return fail("not_signed_in", "Connect your GitHub account first.", 401);

        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed push request.", 400);

        const paths = Object.keys(parsed.data.files);
        if (paths.length === 0) return fail("empty", "There is nothing to push yet.", 400);
        if (paths.length > FILES_LIMIT) {
          return fail("too_many", `Too many files (limit ${FILES_LIMIT}).`, 413);
        }
        const bytes = Object.values(parsed.data.files).reduce(
          (n, c) => n + Buffer.byteLength(c),
          0,
        );
        if (bytes > TOTAL_BYTES_LIMIT) return fail("too_large", "That app is too large.", 413);

        try {
          const target = await pushApp({
            token,
            repoName: repoNameFrom(parsed.data.repoName),
            isPrivate: parsed.data.isPrivate,
            files: parsed.data.files,
            message: parsed.data.message,
          });
          return Response.json({ ok: true, repo: target });
        } catch (e) {
          // GitHub's own message is the useful one — "name already exists on
          // this account", "Repository creation failed" — so it is passed
          // through rather than replaced with something generic.
          return fail("github", e instanceof Error ? e.message : "Push failed.", 400);
        }
      },
    },
  },
});
