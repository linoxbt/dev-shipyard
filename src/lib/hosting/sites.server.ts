import { createHmac, randomBytes } from "node:crypto";
import { promises as dns } from "node:dns";
import { dbConfigured, insertReturning, remove, select, update } from "@/lib/db/admin.server";

// DevStation hosting: an app published here is served at
// <slug>.devstation.online, and at a domain of its owner's once that domain
// points here. Publishing uploads the project's built files to the public
// "sites" storage bucket under <site>/<deploy>/; serving reads the current
// deploy (serve.server.ts).
//
// SITES_DOMAIN (default devstation.online) is the parent domain; it needs a
// wildcard (*.devstation.online) on this Vercel project. Custom domains need
// VERCEL_API_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team).

export const SITES_DOMAIN = (process.env.SITES_DOMAIN || "devstation.online").toLowerCase();

/** Subdomains that are DevStation's own, or could pass for it. */
const RESERVED = new Set(
  (
    "www app api admin root roots docs console dashboard auth login signin signup account " +
    "accounts billing pay payments checkout credits stats status help support mail email smtp " +
    "imap pop ftp cdn static assets img images media files upload uploads blog news dev staging " +
    "test preview demo beta ns ns1 ns2 m mobile secure security devstation official team staff " +
    "internal store shop market marketplace hosting sites site deploy"
  ).split(" "),
);

const SLUG = /^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$/;

export interface Site {
  id: string;
  owner: string;
  slug: string;
  name: string;
  workspace: string | null;
  current_deploy: string | null;
  files: number;
  bytes: number;
  custom_domain: string | null;
  domain_verified: boolean;
  created_at: string;
  updated_at: string;
  deployed_at: string | null;
}

/** A project name as a subdomain: "Warden: Tower Defense!" is "warden-tower-defense". */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : `${s || "app"}-${randomBytes(2).toString("hex")}`;
}

/** Null when the subdomain may be used, or why not. */
export function slugProblem(slug: string): string | null {
  if (!SLUG.test(slug)) {
    return "Use 3 to 40 lowercase letters, numbers and hyphens, starting and ending with a letter or number.";
  }
  if (RESERVED.has(slug)) return "That name is reserved. Choose another.";
  return null;
}

export const siteUrl = (slug: string) => `https://${slug}.${SITES_DOMAIN}`;

// ------------------------------------------------------------------ lookup

const cache = new Map<string, { site: Site | null; until: number }>();
const CACHE_MS = 30_000;

async function cached(key: string, load: () => Promise<Site | null>): Promise<Site | null> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.site;
  // A failed lookup is not remembered as "no site": it throws, and the next
  // request asks again.
  const site = await load();
  cache.set(key, { site, until: Date.now() + CACHE_MS });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return site;
}

export function forgetSite(site: Pick<Site, "slug" | "custom_domain">): void {
  cache.delete(`slug:${site.slug}`);
  if (site.custom_domain) cache.delete(`domain:${site.custom_domain}`);
}

export function siteBySlug(slug: string): Promise<Site | null> {
  return cached(`slug:${slug}`, async () => {
    const [row] = await select<Site>("sites", `slug=eq.${encodeURIComponent(slug)}&select=*`);
    return row ?? null;
  });
}

export function siteByDomain(domain: string): Promise<Site | null> {
  return cached(`domain:${domain}`, async () => {
    const [row] = await select<Site>(
      "sites",
      `custom_domain=eq.${encodeURIComponent(domain)}&select=*`,
    );
    return row ?? null;
  });
}

/** Which site a hostname is, if any: a free subdomain, or a custom domain.
 *  The app's own hosts are never sites. */
export async function siteForHost(
  host: string,
  appHosts: readonly string[] = [],
): Promise<Site | null> {
  const name = host.split(":")[0].toLowerCase().replace(/\.$/, "");
  if (!dbConfigured() || !name || appHosts.includes(name)) return null;
  if (name === SITES_DOMAIN || name === "localhost" || /^[\d.]+$/.test(name)) return null;
  if (name.endsWith(".vercel.app") || name.endsWith(".netlify.app")) return null;
  if (name.endsWith(`.${SITES_DOMAIN}`)) {
    const sub = name.slice(0, -SITES_DOMAIN.length - 1);
    if (sub.includes(".") || RESERVED.has(sub) || !SLUG.test(sub)) return null;
    return siteBySlug(sub);
  }
  const site = await siteByDomain(name);
  return site?.domain_verified ? site : null;
}

// ------------------------------------------------------------------ storage

const storageUrl = () =>
  String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const serviceKey = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

function storageHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const k = serviceKey();
  return {
    apikey: k,
    ...(k.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${k}` }),
    ...extra,
  };
}

/** Where a deployed file can be read, publicly. */
export function fileUrl(siteId: string, deploy: string, path: string): string {
  const safe = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  return `${storageUrl()}/storage/v1/object/public/sites/${siteId}/${deploy}/${safe}`;
}

async function upload(path: string, body: Uint8Array, type: string): Promise<void> {
  const safe = path
    .split("/")
    .map((p) => encodeURIComponent(p))
    .join("/");
  const res = await fetch(`${storageUrl()}/storage/v1/object/sites/${safe}`, {
    method: "POST",
    headers: storageHeaders({ "content-type": type, "x-upsert": "true", "cache-control": "3600" }),
    body: new Blob([body as BlobPart], { type }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Uploading ${path} failed (${res.status}).`);
}

/** Remove every file under a prefix (an old deploy), as far as it can. */
async function removePrefix(prefix: string): Promise<void> {
  const names: string[] = [];
  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return;
    const res = await fetch(`${storageUrl()}/storage/v1/object/list/sites`, {
      method: "POST",
      headers: storageHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ prefix: dir, limit: 1000 }),
    });
    if (!res.ok) return;
    const items = (await res.json()) as { name: string; id: string | null }[];
    for (const it of items) {
      const full = `${dir}/${it.name}`;
      if (it.id) names.push(full);
      else await walk(full, depth + 1);
    }
  };
  await walk(prefix, 0);
  for (let i = 0; i < names.length; i += 500) {
    await fetch(`${storageUrl()}/storage/v1/object/sites`, {
      method: "DELETE",
      headers: storageHeaders({ "content-type": "application/json" }),
      body: JSON.stringify({ prefixes: names.slice(i, i + 500) }),
    }).catch(() => undefined);
  }
}

/** Remove a site's deploys other than `keep` (its folders in storage). */
async function pruneDeploys(siteId: string, keep: (string | null)[]): Promise<void> {
  const res = await fetch(`${storageUrl()}/storage/v1/object/list/sites`, {
    method: "POST",
    headers: storageHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ prefix: siteId, limit: 1000 }),
  });
  if (!res.ok) return;
  const items = (await res.json()) as { name: string; id: string | null }[];
  for (const it of items) {
    if (it.id || keep.includes(it.name)) continue;
    await removePrefix(`${siteId}/${it.name}`);
  }
}

export const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  map: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  webmanifest: "application/manifest+json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
  wasm: "application/wasm",
  pdf: "application/pdf",
};

export function typeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

// ------------------------------------------------------------------ publish

const MAX_SITE_BYTES = 80_000_000;

/** A file path from a build, made safe to store and serve. */
function cleanPath(path: string): string | null {
  const p = path.replace(/^\.?\/+/, "");
  if (!p || p.split("/").some((part) => part === ".." || part === "" || part.startsWith(".")))
    return null;
  return p;
}

/**
 * Publish a build: its text files (`dist`) and its images and fonts (`assets`,
 * base64) go up as a new deploy, the site points at it, and the deploy before
 * it is removed. Creates the site the first time; a subdomain already taken by
 * another account is refused.
 */
export async function publishSite(input: {
  owner: string;
  slug: string;
  name: string;
  workspace: string;
  dist: Record<string, string>;
  assets: Record<string, string>;
}): Promise<{ ok: true; site: Site } | { ok: false; message: string }> {
  const problem = slugProblem(input.slug);
  if (problem) return { ok: false, message: problem };
  if (!input.dist["index.html"]) {
    return { ok: false, message: "The build has no index.html to serve. Build the app first." };
  }
  const [existing] = await select<Site>(
    "sites",
    `slug=eq.${encodeURIComponent(input.slug)}&select=*`,
  );
  if (existing && existing.owner !== input.owner) {
    return { ok: false, message: `${input.slug}.${SITES_DOMAIN} is taken. Choose another name.` };
  }
  // One of this person's other projects lives there: publishing would put
  // this one in its place without a word. Moving an address is a choice.
  if (existing && existing.workspace && existing.workspace !== input.workspace) {
    return {
      ok: false,
      message: `You already publish ${existing.name || "another project"} at ${input.slug}.${SITES_DOMAIN}. Choose another name for this one.`,
    };
  }

  const files: { path: string; body: Uint8Array }[] = [];
  for (const [path, text] of Object.entries(input.dist)) {
    const p = cleanPath(path);
    if (p) files.push({ path: p, body: new TextEncoder().encode(text) });
  }
  for (const [path, b64] of Object.entries(input.assets)) {
    const p = cleanPath(path);
    if (p && !input.dist[path]) files.push({ path: p, body: Buffer.from(b64, "base64") });
  }
  const bytes = files.reduce((n, f) => n + f.body.length, 0);
  if (bytes > MAX_SITE_BYTES) {
    return { ok: false, message: "This build is over 80 MB, too large to publish here." };
  }

  const site =
    existing ??
    (await insertReturning<Site>("sites", {
      owner: input.owner,
      slug: input.slug,
      name: input.name.slice(0, 120),
      workspace: input.workspace,
    }));
  if (!site) return { ok: false, message: "The site could not be created." };
  // Its own address on the Vercel project, so it gets a certificate of its
  // own (with a wildcard CNAME at the DNS host, no move of nameservers).
  // Every publish, not only the first: one made before the API token was set
  // gets its address now. Adding it again is harmless.
  await registerSubdomain(input.slug).catch(() => undefined);

  const deploy = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  // A few at a time: fast, without flooding storage.
  for (let i = 0; i < files.length; i += 6) {
    await Promise.all(
      files
        .slice(i, i + 6)
        .map((f) => upload(`${site.id}/${deploy}/${f.path}`, f.body, typeOf(f.path))),
    );
  }
  const now = new Date().toISOString();
  const [saved] = await update<Site>("sites", `id=eq.${site.id}`, {
    current_deploy: deploy,
    files: files.length,
    bytes,
    name: input.name.slice(0, 120),
    workspace: input.workspace,
    updated_at: now,
    deployed_at: now,
  });
  forgetSite(site);
  // The deploy before this one stays: other servers may still have the site
  // cached (for up to CACHE_MS) and serve its files until they look again.
  // Any older one goes.
  await pruneDeploys(site.id, [deploy, site.current_deploy]).catch(() => undefined);
  return { ok: true, site: saved ?? { ...site, current_deploy: deploy } };
}

/** Add <slug>.devstation.online to the Vercel project (needs the API token):
 *  with a wildcard CNAME at the domain's DNS host, Vercel then issues it a
 *  certificate of its own. A wildcard project domain needs Vercel's
 *  nameservers; this needs nothing moved. */
export async function registerSubdomain(slug: string): Promise<void> {
  if (!customDomainsEnabled()) return;
  const id = encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");
  await vercel(`/v10/projects/${id}/domains${vercelQuery()}`, {
    method: "POST",
    body: JSON.stringify({ name: `${slug}.${SITES_DOMAIN}` }),
  });
}

/** Take a site down: its files, its domain and its row. */
export async function unpublishSite(site: Site): Promise<void> {
  if (site.custom_domain) await removeDomain(site.custom_domain).catch(() => undefined);
  if (customDomainsEnabled()) {
    await removeDomain(`${site.slug}.${SITES_DOMAIN}`).catch(() => undefined);
  }
  await removePrefix(site.id).catch(() => undefined);
  await remove("sites", `id=eq.${site.id}`);
  forgetSite(site);
}

// ------------------------------------------------------------------ custom domains

const vercelQuery = () =>
  process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : "";

export function customDomainsEnabled(): boolean {
  return Boolean(process.env.VERCEL_API_TOKEN && process.env.VERCEL_PROJECT_ID);
}

async function vercel<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(`https://api.vercel.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.VERCEL_API_TOKEN ?? ""}`,
      "content-type": "application/json",
      ...(init.headers as Record<string, string>),
    },
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as T };
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function domainProblem(domain: string): string | null {
  if (!DOMAIN.test(domain)) return "That is not a domain name, like app.example.com.";
  if (domain === SITES_DOMAIN || domain.endsWith(`.${SITES_DOMAIN}`)) {
    return `Use a domain of your own: ${SITES_DOMAIN} addresses come with every site.`;
  }
  if (/\.(vercel\.app|netlify\.app)$/.test(domain)) return "Use a domain of your own.";
  return null;
}

export interface DomainStatus {
  domain: string;
  verified: boolean;
  configured: boolean;
  /** The ownership TXT record is in place (see ownershipRecord). */
  owned?: boolean;
  /** The DNS records to create at the domain's registrar. */
  records: { type: string; name: string; value: string }[];
}

/** The records a domain needs: an A record at the apex, a CNAME below it, and
 *  any verification TXT record Vercel asks for. */
function recordsFor(
  domain: string,
  verification: { type: string; domain: string; value: string }[] = [],
): DomainStatus["records"] {
  const apex = domain.split(".").length === 2;
  const host = apex ? "@" : domain.split(".").slice(0, -2).join(".");
  return [
    apex
      ? { type: "A", name: "@", value: "76.76.21.21" }
      : { type: "CNAME", name: host, value: "cname.vercel-dns.com" },
    ...verification.map((v) => ({ type: v.type, name: v.domain, value: v.value })),
  ];
}

// ------------------------------------------------------------------ ownership

/**
 * The TXT record that proves a domain belongs to the person adding it, for
 * one site: a value only this server can make for that site and domain.
 * Pointing a domain at the host is not proof: anyone could add a domain
 * they do not own, wait for its owner to point it here, and take it.
 */
export function ownershipRecord(
  siteId: string,
  domain: string,
  secret = process.env.SESSION_SECRET || process.env.RUNNER_TOKEN || "devstation",
): { type: string; name: string; value: string } {
  const proof = createHmac("sha256", secret)
    .update(`site-domain:${siteId}:${domain.toLowerCase()}`)
    .digest("hex")
    .slice(0, 40);
  return { type: "TXT", name: `_devstation.${domain}`, value: `devstation-site=${proof}` };
}

/** Whether the domain's DNS carries this site's ownership record. */
export async function provesOwnership(
  siteId: string,
  domain: string,
  resolveTxt: (name: string) => Promise<string[][]> = (n) => dns.resolveTxt(n),
): Promise<boolean> {
  const want = ownershipRecord(siteId, domain);
  try {
    const found = await resolveTxt(want.name);
    return found.some((chunks) => chunks.join("") === want.value);
  } catch {
    return false;
  }
}

export async function addDomain(
  domain: string,
  siteId: string,
): Promise<DomainStatus | { error: string }> {
  const id = encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");
  const r = await vercel<{
    verified?: boolean;
    verification?: { type: string; domain: string; value: string }[];
    error?: { code?: string; message?: string };
  }>(`/v10/projects/${id}/domains${vercelQuery()}`, {
    method: "POST",
    body: JSON.stringify({ name: domain }),
  });
  if (!r.ok && r.data.error?.code !== "domain_already_in_use") {
    return { error: r.data.error?.message ?? "The domain could not be added." };
  }
  return domainStatus(domain, siteId);
}

/** Whether a domain is live for a site: on the host, pointed at it, and
 *  proven to be the site owner's. */
export const domainLive = (s: DomainStatus) => s.verified && s.configured && s.owned === true;

export async function domainStatus(domain: string, siteId: string): Promise<DomainStatus> {
  const id = encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");
  const [project, config] = await Promise.all([
    vercel<{
      verified?: boolean;
      verification?: { type: string; domain: string; value: string }[];
    }>(`/v9/projects/${id}/domains/${encodeURIComponent(domain)}${vercelQuery()}`),
    vercel<{ misconfigured?: boolean }>(
      `/v6/domains/${encodeURIComponent(domain)}/config${vercelQuery()}`,
    ),
  ]);
  if (project.ok && project.data.verified === false) {
    // Ask Vercel to look again; harmless when nothing has changed.
    await vercel(
      `/v9/projects/${id}/domains/${encodeURIComponent(domain)}/verify${vercelQuery()}`,
      { method: "POST" },
    ).catch(() => undefined);
  }
  return {
    domain,
    verified: project.ok && project.data.verified !== false,
    configured: config.ok && config.data.misconfigured === false,
    owned: await provesOwnership(siteId, domain),
    records: [...recordsFor(domain, project.data.verification), ownershipRecord(siteId, domain)],
  };
}

export async function removeDomain(domain: string): Promise<void> {
  const id = encodeURIComponent(process.env.VERCEL_PROJECT_ID ?? "");
  await vercel(`/v9/projects/${id}/domains/${encodeURIComponent(domain)}${vercelQuery()}`, {
    method: "DELETE",
  });
}

export async function setDomain(
  site: Site,
  domain: string | null,
  verified = false,
): Promise<Site> {
  const [saved] = await update<Site>("sites", `id=eq.${site.id}`, {
    custom_domain: domain,
    domain_verified: verified,
    updated_at: new Date().toISOString(),
  });
  forgetSite(site);
  return saved ?? site;
}
