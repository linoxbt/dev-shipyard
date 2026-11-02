import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";
import {
  communityProjects,
  communitySnapshot,
  editTemplate,
  encodeBody,
  featureProject,
  listTemplates,
  moveTemplate,
  refreshTemplate,
  removeTemplate,
  templateView,
  type TemplateRow,
} from "@/lib/templates/templates.server";
import { pseudonym } from "@/lib/db/stats.server";

// Choosing community apps for the Templates tab, for the people in
// ADMIN_EMAILS:
//
// GET ?q=&offset=        every account's saved projects, newest first, and the
//                        templates already chosen
// GET ?project=<ref>     one project's files and build, to look at it running
// POST {action: "feature", ref, name, blurb}
// POST {action: "edit", id, name?, blurb?}
// POST {action: "refresh", id}     copy the builder's latest version again
// POST {action: "move", id, by}    one place up (-1) or down (1)
// POST {action: "remove", id}

const ID = z.string().uuid();
const name = z.string().trim().min(1).max(80);
const blurb = z.string().trim().max(240);

const actions = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("feature"),
    ref: z.string().max(130),
    name,
    blurb: blurb.default(""),
  }),
  z.object({ action: z.literal("edit"), id: ID, name: name.optional(), blurb: blurb.optional() }),
  z.object({ action: z.literal("refresh"), id: ID }),
  z.object({ action: z.literal("move"), id: ID, by: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ action: z.literal("remove"), id: ID }),
]);

const adminView = (t: TemplateRow) => ({
  ...templateView(t),
  ref: `${t.source_owner}:${t.source_project}`,
  builder: pseudonym(t.source_owner),
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});

const noStore = { headers: { "cache-control": "no-store" } };

export const Route = createFileRoute("/api/admin/templates")({
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
        const url = new URL(request.url);
        try {
          const ref = url.searchParams.get("project");
          if (ref !== null) {
            const snap = await communitySnapshot(ref);
            if (!snap) return fail("not_found", "That project is gone or empty.", 404);
            return Response.json({ ok: true, body: encodeBody(snap) }, noStore);
          }
          const [community, templates] = await Promise.all([
            communityProjects({
              q: url.searchParams.get("q") ?? "",
              offset: Number(url.searchParams.get("offset")) || 0,
            }),
            listTemplates(),
          ]);
          return Response.json(
            { ok: true, ...community, templates: templates.map(adminView) },
            noStore,
          );
        } catch (error) {
          console.error("admin templates", error);
          return fail("db", "The projects could not be read just now.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner || !isAdmin(owner)) {
          return fail("forbidden", "This page is for DevStation's admins.", 403);
        }
        if (!dbConfigured()) {
          return fail(
            "not_configured",
            "Add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.",
            503,
          );
        }
        const parsed = actions.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const data = parsed.data;
        try {
          if (data.action === "feature") {
            const made = await featureProject({ ...data, by: owner });
            if (!made.ok) return fail("template", made.message, made.status);
            return Response.json({ ok: true, template: adminView(made.value) });
          }
          if (data.action === "refresh") {
            const done = await refreshTemplate(data.id);
            if (!done.ok) return fail("template", done.message, done.status);
            return Response.json({ ok: true, template: adminView(done.value) });
          }
          if (data.action === "edit") {
            const patch = {
              ...(data.name !== undefined ? { name: data.name } : {}),
              ...(data.blurb !== undefined ? { blurb: data.blurb } : {}),
            };
            const saved = await editTemplate(data.id, patch);
            if (!saved) return fail("not_found", "That template is gone.", 404);
            return Response.json({ ok: true, template: adminView(saved) });
          }
          if (data.action === "move") await moveTemplate(data.id, data.by);
          else await removeTemplate(data.id);
          return Response.json({ ok: true });
        } catch (error) {
          console.error("admin templates", error);
          return fail("db", "That did not work just now. Try again in a moment.", 502);
        }
      },
    },
  },
});
