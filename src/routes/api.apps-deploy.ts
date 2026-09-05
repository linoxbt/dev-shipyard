import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// Publishes a generated app to a public URL.
//
// Two paths, same handler:
//  - DevStation-hosted: uses this deployment's own Netlify token. Rate limited
//    per wallet and per IP, because it spends someone else's hosting quota and
//    puts arbitrary user content on a DevStation subdomain.
//  - Bring-your-own: the caller supplies their own token, so nothing of ours
//    is spent and the site lands in their account. Still rate limited per IP to
//    stop this being used as an open proxy to Netlify.
//
// Netlify's file-digest deploy API is a two-step handshake: POST the SHA1 of
// every file, get back the subset it does not already have, then PUT those.
// That is why this uploads only what is asked for rather than everything.

const FILES_LIMIT = 60;
const TOTAL_BYTES_LIMIT = 5 * 1024 * 1024;
const PER_WALLET_LIMIT = 5;
const PER_IP_LIMIT = 10;
const GLOBAL_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000;

const bodySchema = z.object({
  /** path -> file contents. Paths are relative to the site root. */
  files: z.record(z.string(), z.string()),
  /** Wallet requesting the deploy, for per-wallet rate limiting. */
  requesterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  /** Desired subdomain; sanitised and uniquified by Netlify anyway. */
  name: z.string().max(60).optional(),
  /** Deploy into the caller's OWN Netlify account instead of ours. */
  ownToken: z.string().min(10).optional(),
  /** Existing site to update, so republishing keeps the same URL. */
  siteId: z.string().max(120).optional(),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

// Server-only. Read inside the handler, never at module scope: some hosts bind
// env per request, where a module-level read is undefined.
function serverConfig() {
  const e = process.env;
  return {
    token: e.NETLIFY_AUTH_TOKEN ?? "",
    /** Optional Netlify team to create sites under. */
    accountSlug: e.NETLIFY_ACCOUNT_SLUG ?? "",
  };
}

async function sha1Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const NETLIFY = "https://api.netlify.com/api/v1";

async function netlify(path: string, token: string, init?: RequestInit) {
  return fetch(`${NETLIFY}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
}

export const Route = createFileRoute("/api/apps-deploy")({
  server: {
    handlers: {
      // Deliberately reports only whether hosting is available: never which
      // variables are set.
      GET: () => Response.json({ configured: serverConfig().token.length > 0 }),

      POST: async ({ request }) => {
        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed deploy request.", 400);
        const { files, requesterAddress, name, ownToken, siteId } = parsed.data;

        const paths = Object.keys(files);
        if (paths.length === 0) return fail("invalid_body", "No files to deploy.", 400);
        if (paths.length > FILES_LIMIT) {
          return fail("too_large", `A site may have at most ${FILES_LIMIT} files.`, 400);
        }
        const totalBytes = Object.values(files).reduce((n, c) => n + c.length, 0);
        if (totalBytes > TOTAL_BYTES_LIMIT) {
          return fail("too_large", "That site is larger than 5MB.", 400);
        }
        if (!paths.some((p) => p === "index.html" || p.endsWith("/index.html"))) {
          return fail("invalid_body", "A site needs an index.html.", 400);
        }

        const ip = clientKeyFromRequest(request);
        const wallet = requesterAddress.toLowerCase();
        if (
          !checkRateLimit(`appdeploy:ip:${ip}`, PER_IP_LIMIT, WINDOW_MS) ||
          (!ownToken &&
            (!checkRateLimit(`appdeploy:wallet:${wallet}`, PER_WALLET_LIMIT, WINDOW_MS) ||
              !checkRateLimit("appdeploy:global", GLOBAL_LIMIT, WINDOW_MS)))
        ) {
          return fail("rate_limited", "Too many deploys. Try again later.", 429);
        }

        const token = ownToken || serverConfig().token;
        if (!token) {
          return fail(
            "not_configured",
            "Hosting is not configured on this deployment. Add your own Netlify token to deploy to your account.",
            501,
          );
        }

        try {
          // 1. Which files does Netlify still need?
          const digests: Record<string, string> = {};
          for (const [path, content] of Object.entries(files)) {
            digests[`/${path.replace(/^\/+/, "")}`] = await sha1Hex(content);
          }

          let site = siteId;
          if (!site) {
            const cfg = serverConfig();
            const createPath =
              !ownToken && cfg.accountSlug ? `/${cfg.accountSlug}/sites` : "/sites";
            const created = await netlify(createPath, token, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(name ? { name } : {}),
            });
            if (!created.ok) {
              const detail = await created.text();
              return fail(
                "provider_error",
                `Could not create the site (${created.status}). ${detail.slice(0, 200)}`,
                502,
              );
            }
            site = ((await created.json()) as { id: string }).id;
          }

          const deployResp = await netlify(`/sites/${site}/deploys`, token, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files: digests }),
          });
          if (!deployResp.ok) {
            const detail = await deployResp.text();
            return fail(
              "provider_error",
              `Deploy rejected (${deployResp.status}). ${detail.slice(0, 200)}`,
              502,
            );
          }
          const deploy = (await deployResp.json()) as {
            id: string;
            required?: string[];
            ssl_url?: string;
            deploy_ssl_url?: string;
          };

          // 2. Upload only the files it asked for, matched back by digest.
          const bySha = new Map<string, { path: string; content: string }>();
          for (const [path, content] of Object.entries(files)) {
            bySha.set(await sha1Hex(content), { path, content });
          }
          for (const sha of deploy.required ?? []) {
            const entry = bySha.get(sha);
            if (!entry) continue;
            const put = await netlify(
              `/deploys/${deploy.id}/files/${encodeURI(entry.path.replace(/^\/+/, ""))}`,
              token,
              {
                method: "PUT",
                headers: { "content-type": "application/octet-stream" },
                body: entry.content,
              },
            );
            if (!put.ok) {
              return fail("provider_error", `Uploading ${entry.path} failed (${put.status}).`, 502);
            }
          }

          return Response.json({
            ok: true,
            siteId: site,
            deployId: deploy.id,
            url: deploy.ssl_url ?? deploy.deploy_ssl_url ?? null,
          });
        } catch (e) {
          return fail(
            "provider_error",
            e instanceof Error ? e.message : "The hosting provider was unreachable.",
            502,
          );
        }
      },
    },
  },
});
