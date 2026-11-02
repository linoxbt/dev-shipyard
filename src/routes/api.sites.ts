import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { dbConfigured, select } from "@/lib/db/admin.server";
import { fail, requestOwner } from "@/lib/db/request.server";
import {
  SITES_DOMAIN,
  addDomain,
  customDomainsEnabled,
  domainProblem,
  domainStatus,
  removeDomain,
  setDomain,
  siteUrl,
  slugProblem,
  unpublishSite,
  type Site,
} from "@/lib/hosting/sites.server";
import { checkReach } from "@/lib/hosting/reach.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// The signed-in account's published apps (publishing itself is
// api/workspace's "publish_site", which reads the build from the project's
// machine):
//
// GET ?workspace=<id>           this project's site, if it has one
// GET                           every site of this account
// POST {action: "check"}        is a subdomain free
// POST {action: "add_domain"}   point a domain of their own at a site
// POST {action: "check_domain"} has its DNS been set up yet
// POST {action: "remove_domain"}
// POST {action: "unpublish"}    take a site down
// POST {action: "reach"}        can the site be opened at its address (or its
//                               own domain) right now, and if not, why

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check"), slug: z.string().trim().toLowerCase().max(60) }),
  z.object({
    action: z.literal("add_domain"),
    siteId: z.string().uuid(),
    domain: z.string().trim().toLowerCase().max(253),
  }),
  z.object({ action: z.literal("check_domain"), siteId: z.string().uuid() }),
  z.object({ action: z.literal("remove_domain"), siteId: z.string().uuid() }),
  z.object({ action: z.literal("unpublish"), siteId: z.string().uuid() }),
  z.object({
    action: z.literal("reach"),
    siteId: z.string().uuid(),
    target: z.enum(["site", "domain"]).default("site"),
  }),
]);

const view = (s: Site) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  url: siteUrl(s.slug),
  workspace: s.workspace,
  files: s.files,
  bytes: Number(s.bytes),
  customDomain: s.custom_domain,
  domainVerified: s.domain_verified,
  deployedAt: s.deployed_at,
});

export const Route = createFileRoute("/api/sites")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Hosting is not set up yet.", 503);
        const workspace = new URL(request.url).searchParams.get("workspace");
        const filter = `owner=eq.${encodeURIComponent(owner)}${
          workspace ? `&workspace=eq.${encodeURIComponent(workspace)}` : ""
        }`;
        try {
          const rows = await select<Site>("sites", `${filter}&select=*&order=updated_at.desc`);
          return Response.json(
            {
              ok: true,
              sitesDomain: SITES_DOMAIN,
              customDomains: customDomainsEnabled(),
              sites: rows.map(view),
            },
            { headers: { "cache-control": "no-store" } },
          );
        } catch {
          return fail("db", "Your sites could not be read just now.", 502);
        }
      },

      POST: async ({ request }) => {
        const owner = requestOwner(request);
        if (!owner) return fail("no_grant", "Sign in with your email first.", 401);
        if (!dbConfigured()) return fail("not_configured", "Hosting is not set up yet.", 503);
        if (!(await checkRateLimit(`sites:${owner}`, 120, 10 * 60_000))) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const data = parsed.data;
        try {
          if (data.action === "check") {
            const problem = slugProblem(data.slug);
            if (problem) return Response.json({ ok: true, available: false, message: problem });
            const [taken] = await select<Site>(
              "sites",
              `slug=eq.${encodeURIComponent(data.slug)}&select=owner`,
            );
            const free = !taken || taken.owner === owner;
            return Response.json({
              ok: true,
              available: free,
              mine: !!taken && taken.owner === owner,
              message: free ? null : `${data.slug}.${SITES_DOMAIN} is taken.`,
            });
          }

          const [site] = await select<Site>(
            "sites",
            `id=eq.${data.siteId}&owner=eq.${encodeURIComponent(owner)}&select=*`,
          );
          if (!site) return fail("not_found", "That site is not yours, or is gone.", 404);

          if (data.action === "unpublish") {
            await unpublishSite(site);
            return Response.json({ ok: true });
          }

          if (data.action === "reach") {
            if (data.target === "domain" && !site.custom_domain) {
              return fail("no_domain", "This site has no domain of its own.", 404);
            }
            const host =
              data.target === "domain" ? site.custom_domain! : `${site.slug}.${SITES_DOMAIN}`;
            const reach = await checkReach(
              host,
              { slug: site.slug, deploy: site.current_deploy },
              { custom: data.target === "domain" },
            );
            return Response.json({ ok: true, reach }, { headers: { "cache-control": "no-store" } });
          }

          if (!customDomainsEnabled()) {
            return fail("unavailable", "Custom domains are not set up on DevStation yet.", 503);
          }

          if (data.action === "add_domain") {
            const problem = domainProblem(data.domain);
            if (problem) return fail("invalid_domain", problem, 400);
            const [other] = await select<Site>(
              "sites",
              `custom_domain=eq.${encodeURIComponent(data.domain)}&select=id`,
            );
            if (other && other.id !== site.id) {
              return fail("domain_taken", "That domain is already on another site.", 409);
            }
            if (site.custom_domain && site.custom_domain !== data.domain) {
              await removeDomain(site.custom_domain).catch(() => undefined);
            }
            const status = await addDomain(data.domain);
            if ("error" in status) return fail("domain", status.error, 400);
            const saved = await setDomain(site, data.domain, status.verified && status.configured);
            return Response.json({ ok: true, site: view(saved), status });
          }

          if (!site.custom_domain)
            return fail("no_domain", "This site has no domain of its own.", 404);

          if (data.action === "check_domain") {
            const status = await domainStatus(site.custom_domain);
            const live = status.verified && status.configured;
            const saved =
              live !== site.domain_verified
                ? await setDomain(site, site.custom_domain, live)
                : site;
            return Response.json({ ok: true, site: view(saved), status });
          }

          await removeDomain(site.custom_domain).catch(() => undefined);
          const saved = await setDomain(site, null, false);
          return Response.json({ ok: true, site: view(saved) });
        } catch (error) {
          console.error("sites", error);
          return fail("sites", "That did not work just now. Try again in a moment.", 502);
        }
      },
    },
  },
});
