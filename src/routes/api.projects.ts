import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured, rpc, select } from "@/lib/db/admin.server";
import { fail, requestOwner } from "@/lib/db/request.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// The signed-in account's projects, kept here so they open the same on every
// device: the chat, the files, the build and the screenshots.
//
// GET              every project's id, name, version and whether it was deleted
// GET ?id=<id>     one project's saved body
// POST             save one version (or a deletion); a newer stored version wins
//
// The body is the project as the browser keeps it, gzipped and base64-encoded
// (lib/appgen/project-sync.ts). This server stores it for its account and
// never reads inside it; the browser checks it on the way back in.

/** A request body on the host is at most 4.5 MB; leave room for the rest. */
export const MAX_BODY_CHARS = 4_200_000;

const ID = /^[A-Za-z0-9_-]{1,80}$/;

const saveBody = z.object({
  id: z.string().regex(ID),
  name: z.string().max(200).default(""),
  updatedAt: z.number().int().positive().max(8_640_000_000_000),
  deleted: z.boolean().default(false),
  body: z.string().max(MAX_BODY_CHARS).optional(),
});

interface Row {
  id: string;
  name: string;
  updated_at: number | string;
  deleted: boolean;
  size: number;
  body?: string | null;
}

const NOT_SET_UP = ["not_configured", "Saving across devices is not set up yet.", 503] as const;

export const Route = createFileRoute("/api/projects")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail(...NOT_SET_UP);
        if (!(await checkRateLimit(`projects-read:${owner}`, 900, 10 * 60_000))) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const id = new URL(request.url).searchParams.get("id");
        const who = `owner=eq.${encodeURIComponent(owner)}`;
        try {
          if (id !== null) {
            if (!ID.test(id)) return fail("invalid_id", "That is not a project id.", 400);
            const [row] = await select<Row>(
              "saved_projects",
              `select=id,updated_at,deleted,body&${who}&id=eq.${encodeURIComponent(id)}`,
            );
            if (!row) return fail("not_found", "That project is not saved here.", 404);
            return Response.json(
              {
                ok: true,
                id: row.id,
                updatedAt: Number(row.updated_at),
                deleted: row.deleted,
                body: row.deleted ? null : (row.body ?? null),
              },
              { headers: { "cache-control": "no-store" } },
            );
          }
          const rows = await select<Row>(
            "saved_projects",
            `select=id,name,updated_at,deleted,size&${who}&order=updated_at.desc&limit=2000`,
          );
          return Response.json(
            {
              ok: true,
              projects: rows.map((r) => ({
                id: r.id,
                name: r.name,
                updatedAt: Number(r.updated_at),
                deleted: r.deleted,
                size: r.size,
              })),
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return fail("db", "Your projects could not be read just now.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail(...NOT_SET_UP);
        if (!(await checkRateLimit(`projects-write:${owner}`, 900, 10 * 60_000))) {
          return fail("rate_limited", "Too many saves. Wait a moment.", 429);
        }
        const parsed = saveBody.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          const tooBig = parsed.error.issues.some(
            (i) => i.path[0] === "body" && i.code === "too_big",
          );
          return tooBig
            ? fail("too_large", "This project is too large to save across devices.", 413)
            : fail("invalid_body", "Malformed request.", 400);
        }
        const p = parsed.data;
        if (!p.deleted && !p.body) return fail("invalid_body", "Nothing to save.", 400);
        try {
          const stored = Number(
            await rpc<number | string>("save_project", {
              p_owner: owner,
              p_id: p.id,
              p_name: p.name,
              p_updated: p.updatedAt,
              p_deleted: p.deleted,
              p_body: p.deleted ? null : p.body,
            }),
          );
          // applied: false means a newer version from another device is
          // stored; the browser fetches that one instead.
          return Response.json({ ok: true, stored, applied: stored === p.updatedAt });
        } catch {
          return fail("db", "This project could not be saved just now.", 502);
        }
      },
    },
  },
});
