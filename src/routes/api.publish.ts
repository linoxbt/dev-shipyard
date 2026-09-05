import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

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
        const raw = await request.json().catch(() => null);
        const parsed = publishSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed publish request.", 400);
        const { owner } = parsed.data;

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
        const raw = await request.json().catch(() => null);
        const parsed = removeSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const ip = clientKeyFromRequest(request);
        const res = await toRunner(
          "/publish",
          {
            method: "DELETE",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: parsed.data.slug }),
          },
          parsed.data.owner,
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
