import { createFileRoute } from "@tanstack/react-router";
import { dbConfigured } from "@/lib/db/admin.server";
import { fail } from "@/lib/db/request.server";
import { listTemplates, templateBody, templateView } from "@/lib/templates/templates.server";

// The community templates an admin has put on the Templates tab, for anyone:
//
// GET           every one's name, blurb and version, in the admin's order
// GET ?id=<id>  one template's files: {files, dist}, gzipped and base64-encoded
//
// Both are public and cached briefly; ?v=<version> names a version, so a
// changed template is fetched afresh.

const ID = /^[0-9a-f-]{36}$/;

export const Route = createFileRoute("/api/templates")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!dbConfigured()) {
          return Response.json(
            { ok: true, templates: [] },
            { headers: { "cache-control": "no-store" } },
          );
        }
        const id = new URL(request.url).searchParams.get("id");
        try {
          if (id !== null) {
            if (!ID.test(id)) return fail("invalid_id", "That is not a template.", 400);
            const body = await templateBody(id);
            if (!body) return fail("not_found", "That template is gone.", 404);
            return Response.json(
              { ok: true, body },
              { headers: { "cache-control": "public, max-age=300, s-maxage=3600" } },
            );
          }
          const rows = await listTemplates();
          return Response.json(
            { ok: true, templates: rows.map(templateView) },
            { headers: { "cache-control": "public, max-age=30, s-maxage=60" } },
          );
        } catch {
          return fail("db", "The templates could not be read just now.", 502);
        }
      },
    },
  },
});
