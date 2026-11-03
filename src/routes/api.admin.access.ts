import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured } from "@/lib/db/admin.server";
import { fail, isAdmin, requestOwner } from "@/lib/db/request.server";
import {
  accessSettings,
  grantAccess,
  grantNext,
  members,
  revokeAccess,
  setAccess,
  waitlist,
} from "@/lib/access/members.server";

// Who may use DevStation, for the people in ADMIN_EMAILS:
//
// GET                              the settings, the waitlist and the members
// POST {action: "set", open?, maxMembers?}   open or close sign-ups, set the limit
// POST {action: "grant", owners}   let these accounts in from the waitlist
// POST {action: "grant_next", n}   let the first n in line in
// POST {action: "revoke", owner}   take an account's access away

const OWNER = z.string().regex(/^0x[0-9a-f]{40}$/);

const actions = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("set"),
    open: z.boolean().optional(),
    maxMembers: z.number().int().min(0).max(10_000_000).nullable().optional(),
  }),
  z.object({ action: z.literal("grant"), owners: z.array(OWNER).min(1).max(500) }),
  z.object({ action: z.literal("grant_next"), n: z.number().int().min(1).max(500) }),
  z.object({ action: z.literal("revoke"), owner: OWNER }),
]);

const NOT_SET_UP = [
  "not_configured",
  "Add SUPABASE_SERVICE_ROLE_KEY to the Vercel project.",
  503,
] as const;

export const Route = createFileRoute("/api/admin/access")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!isAdmin(owner)) return fail("forbidden", "This page is for DevStation's admins.", 403);
        if (!dbConfigured()) return fail(...NOT_SET_UP);
        try {
          const [settings, waiting, people] = await Promise.all([
            accessSettings(),
            waitlist(),
            members(),
          ]);
          return Response.json(
            {
              ok: true,
              settings,
              waitlist: waiting.map((w) => ({
                owner: w.owner,
                email: w.email,
                joinedAt: w.joined_at,
                lastSeenAt: w.last_seen_at,
                held: w.held,
              })),
              members: people.map((m) => ({
                owner: m.owner,
                email: m.email,
                admittedAt: m.admitted_at,
                via: m.via,
              })),
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch (error) {
          console.error("admin access", error);
          return fail("db", "Access could not be read just now.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner || !isAdmin(owner)) {
          return fail("forbidden", "This page is for DevStation's admins.", 403);
        }
        if (!dbConfigured()) return fail(...NOT_SET_UP);
        const parsed = actions.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const data = parsed.data;
        try {
          if (data.action === "set") {
            await setAccess({ open: data.open, maxMembers: data.maxMembers }, owner);
            return Response.json({ ok: true, settings: await accessSettings() });
          }
          if (data.action === "grant") {
            return Response.json({ ok: true, granted: await grantAccess(data.owners, owner) });
          }
          if (data.action === "grant_next") {
            return Response.json({ ok: true, granted: await grantNext(data.n, owner) });
          }
          if (isAdmin(data.owner)) {
            return fail("admin", "An admin's access comes from ADMIN_EMAILS.", 400);
          }
          return Response.json({ ok: true, revoked: await revokeAccess(data.owner) });
        } catch (error) {
          console.error("admin access", error);
          return fail("db", "That did not work just now. Try again in a moment.", 502);
        }
      },
    },
  },
});
