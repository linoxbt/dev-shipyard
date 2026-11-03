import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured, insert, select } from "@/lib/db/admin.server";
import { fail, requestEmail, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// What people think of DevStation, asked once they have built or published
// an app (routes/feedback.tsx), and read by the admins (api/admin/feedback).
//
// GET   whether this account has sent feedback yet
// POST  send it

const body = z.object({
  rating: z.number().int().min(1).max(5),
  recommend: z.number().int().min(0).max(10).nullable().default(null),
  built: z.string().trim().max(2000).default(""),
  worked: z.string().trim().max(4000).default(""),
  improve: z.string().trim().max(4000).default(""),
  project: z.string().trim().max(200).nullable().default(null),
  siteUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^https:\/\//)
    .nullable()
    .default(null),
});

export const Route = createFileRoute("/api/feedback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return Response.json({ ok: true, submitted: 0 });
        try {
          const rows = await select<{ id: string }>(
            "feedback",
            `owner=eq.${encodeURIComponent(owner)}&select=id&limit=20`,
          );
          return Response.json(
            { ok: true, submitted: rows.length },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return fail("db", "That could not be read just now.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Feedback is not set up yet.", 503);
        if (!(await checkRateLimit(`feedback:${owner}`, 10, 24 * 60 * 60_000))) {
          return fail("rate_limited", "Thank you! That is plenty of feedback for one day.", 429);
        }
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Choose a rating, then send.", 400);
        const f = parsed.data;
        try {
          await insert("feedback", {
            owner,
            email: requestEmail(request),
            rating: f.rating,
            recommend: f.recommend,
            built: f.built,
            worked: f.worked,
            improve: f.improve,
            project: f.project,
            site_url: f.siteUrl,
          });
          return Response.json({ ok: true });
        } catch {
          return fail("db", "Your feedback could not be saved just now. Try again.", 502);
        }
      },
    },
  },
});
