import { createFileRoute } from "@tanstack/react-router";
import { dbConfigured, selectAll } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";
import { csv } from "@/lib/db/stats.server";

// Everything people told DevStation through the feedback form, for the people
// in ADMIN_EMAILS: newest first, with the averages; ?download=csv for a file.

interface Row {
  id: string;
  owner: string;
  email: string | null;
  rating: number;
  recommend: number | null;
  built: string;
  worked: string;
  improve: string;
  project: string | null;
  site_url: string | null;
  created_at: string;
}

const COLUMNS = [
  "created_at",
  "email",
  "rating",
  "recommend",
  "built",
  "worked",
  "improve",
  "project",
  "site_url",
];

/** Net promoter score: the share who would recommend (9, 10) less the share
 *  who would not (0 to 6), from -100 to 100. */
export function nps(scores: number[]): number | null {
  if (!scores.length) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

export const Route = createFileRoute("/api/admin/feedback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!isAdmin(owner)) return fail("forbidden", "This page is for DevStation's admins.", 403);
        if (!dbConfigured()) {
          return fail(
            "not_configured",
            "Add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.",
            503,
          );
        }
        try {
          const rows = await selectAll<Row>("feedback", "select=*&order=created_at.desc");
          if (new URL(request.url).searchParams.get("download") === "csv") {
            return new Response(csv(rows as unknown as Record<string, unknown>[], COLUMNS), {
              headers: {
                "content-type": "text/csv; charset=utf-8",
                "content-disposition": `attachment; filename="devstation-feedback-${new Date().toISOString().slice(0, 10)}.csv"`,
                "cache-control": "no-store",
              },
            });
          }
          const ratings = rows.map((r) => r.rating);
          const recommends = rows.map((r) => r.recommend).filter((n): n is number => n !== null);
          const byRating = [1, 2, 3, 4, 5].map((n) => ratings.filter((r) => r === n).length);
          return Response.json(
            {
              ok: true,
              summary: {
                responses: rows.length,
                people: new Set(rows.map((r) => r.owner)).size,
                averageRating: ratings.length
                  ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
                  : null,
                nps: nps(recommends),
                byRating,
              },
              feedback: rows.map((r) => ({
                id: r.id,
                email: r.email,
                rating: r.rating,
                recommend: r.recommend,
                built: r.built,
                worked: r.worked,
                improve: r.improve,
                project: r.project,
                siteUrl: r.site_url,
                createdAt: r.created_at,
              })),
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("admin feedback", error);
          return fail("db", "Feedback could not be read just now.", 502);
        }
      },
    },
  },
});
