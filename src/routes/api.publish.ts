import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import { CLAIM_COOKIE, openClaims, ownerOf, readCookie } from "@/lib/agent-access/claims.server";

// Publishes a built app to <name>.devstation.online.
//
// A thin proxy in front of the runner's /publish, for the same reason the other
// runner-backed routes here are proxies: the runner's token must never reach a
// browser.
//
// Apps are hosted on the runner host rather than on Netlify because a subdomain
// there costs a site from a limited plan, while here it is a directory. See
// services/runner/src/publish.ts for the ownership and path-safety rules: a
// published app is arbitrary user content on a DevStation hostname, so the
// wallet that first claims a name is the only one that can overwrite it.

const PER_IP_LIMIT = 20;
const PER_WALLET_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000;

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;

const publishSchema = z.object({
  slug: z.string().min(1).max(60),
  files: z.record(z.string(), z.string()),
  owner: z.string().regex(ADDRESS),
});

const removeSchema = z.object({
  slug: z.string().min(1).max(60),
  owner: z.string().regex(ADDRESS),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

/** The verified wallet behind this request, or null. One signature at
 *  /api/access issues the cookie; see api.access.ts for why it is a grant
 *  rather than a signature per call. */
function grantedOwner(request: Request): string | null {
  return ownerOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
}

const NO_GRANT = [
  "no_grant",
  "Connect a wallet and sign once to use this. It costs no gas.",
  401,
] as const;

function serverConfig() {
  const e = process.env;
  return {
    url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""),
    token: e.RUNNER_TOKEN ?? "",
  };
}

async function toRunner(path: string, init: RequestInit, owner: string, caller: string) {
  const cfg = serverConfig();
  if (!cfg.url || !cfg.token) return null;
  return fetch(`${cfg.url}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${cfg.token}`,
      "x-devstation-owner": owner,
      "x-devstation-caller": caller,
    },
  }).catch(() => null);
}

export const Route = createFileRoute("/api/publish")({
  server: {
    handlers: {
      // Reports availability, or lists the caller's own sites.
      GET: async ({ request }) => {
        const cfg = serverConfig();
        const owner = new URL(request.url).searchParams.get("owner");
        if (!owner) {
          return Response.json({ configured: cfg.url.length > 0 && cfg.token.length > 0 });
        }
        if (!ADDRESS.test(owner)) return fail("bad_owner", "Unknown wallet.", 400);
        const ip = clientKeyFromRequest(request);
        const res = await toRunner("/publish", { method: "GET" }, owner, ip);
        if (!res) return fail("unreachable", "Publishing is unavailable.", 502);
        return new Response(await res.text(), {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },

      POST: async ({ request }) => {
        // This spends the operator's build and hosting resources, so it is not
        // something an anonymous caller gets to do. Before this the only
        // control was an in-memory IP limit, which rateLimit.server.ts says in
        // its own header is friction rather than a boundary.
        const granted = grantedOwner(request);
        if (!granted) return fail(...NO_GRANT);

        const raw = await request.json().catch(() => null);
        const parsed = publishSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed publish request.", 400);
        // The owner is the wallet that signed, not the one in the body. A site
        // is owned by whoever published it, and before the grant existed a
        // caller could name any wallet and publish under it.
        const { owner: claimedOwner } = parsed.data;
        if (claimedOwner.toLowerCase() !== granted.toLowerCase()) {
          return fail("owner_mismatch", "You can only publish under your own wallet.", 403);
        }
        const owner = granted;

        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`publish:ip:${ip}`, PER_IP_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many publishes. Try again later.", 429);
        }
        if (!checkRateLimit(`publish:wallet:${owner.toLowerCase()}`, PER_WALLET_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many publishes from this wallet.", 429);
        }

        const res = await toRunner(
          "/publish",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: parsed.data.slug, files: parsed.data.files }),
          },
          owner,
          ip,
        );
        if (!res) return fail("unreachable", "Publishing is unavailable.", 502);
        return new Response(await res.text(), {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },

      DELETE: async ({ request }) => {
        // Taking a site down is the owner's decision. The runner enforces the
        // same rule from the header this sends; both check, because either one
        // alone is a single point of failure for somebody else's site.
        const granted = grantedOwner(request);
        if (!granted) return fail(...NO_GRANT);

        const raw = await request.json().catch(() => null);
        const parsed = removeSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        if (parsed.data.owner.toLowerCase() !== granted.toLowerCase()) {
          return fail("owner_mismatch", "You can only remove your own sites.", 403);
        }
        const owner = granted;
        const ip = clientKeyFromRequest(request);
        const res = await toRunner(
          "/publish",
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: parsed.data.slug }),
          },
          owner,
          ip,
        );
        if (!res) return fail("unreachable", "Publishing is unavailable.", 502);
        return new Response(await res.text(), {
          status: res.status,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
