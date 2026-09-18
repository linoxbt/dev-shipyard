// Static hosting for published App Builder apps, served at <name>.devstation.online.
//
// Apps live on this host rather than on Netlify because a Netlify free plan has
// a site limit and every publish would burn one. Here a publish is a directory,
// which costs nothing and is instant.
//
// Caddy serves these directly off disk with on-demand TLS. That makes the "does
// this subdomain exist" check security-critical, not cosmetic: without it,
// anyone who pointed a DNS record at this box could make us request a
// certificate on their behalf. See canServe(), which is what Caddy asks.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const PUBLISH_DIR = process.env.PUBLISH_DIR ?? "/srv/devstation-apps";
/** Where a site's metadata lives, beside its files but never served: the
 *  filename starts with a dot and Caddy is configured to hide it. */
const MANIFEST = ".devstation.json";

export const MAX_PUBLISH_FILES = 200;
export const MAX_PUBLISH_BYTES = 10 * 1024 * 1024;

/** Names that must never become a user's app, because they are (or could
 *  become) infrastructure. `backend` and `build` already exist as real hosts;
 *  the rest are reserved before somebody takes them. */
const RESERVED = new Set([
  "www",
  "api",
  "app",
  "admin",
  "backend",
  "build",
  "cdn",
  "assets",
  "static",
  "mail",
  "smtp",
  "imap",
  "ftp",
  "ns1",
  "ns2",
  "dns",
  "docs",
  "doc",
  "blog",
  "dashboard",
  "status",
  "help",
  "support",
  "explorer",
  "registry",
  "runner",
  "test",
  "staging",
  "dev",
  "preview",
  "internal",
  "root",
  "localhost",
]);

export interface Manifest {
  slug: string;
  /** Wallet that published it. Only this wallet may overwrite the site: a
   *  subdomain is a name people share, so it cannot be first-come-then-stolen. */
  owner: string;
  createdAt: number;
  updatedAt: number;
  fileCount: number;
  bytes: number;
}

/** The label a name would become, before it is judged usable. */
function cleanLabel(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function normaliseSlug(raw: string): string | null {
  const slug = cleanLabel(raw);
  if (slug.length < 2 || slug.length > 40) return null;
  if (RESERVED.has(slug)) return null;
  // A label that is all digits, or looks like an IP part, invites confusion
  // with the sslip.io style hosts this box already answers on.
  if (/^\d+$/.test(slug)) return null;
  return slug;
}

function dirFor(slug: string): string {
  return join(PUBLISH_DIR, slug);
}

/** True when the subdomain is a real published app. Caddy asks this before
 *  requesting a certificate, so it must be cheap and must never throw. */
export function canServe(host: string): boolean {
  const name = host.toLowerCase().split(":")[0];
  const suffix = ".devstation.online";
  if (!name.endsWith(suffix)) return false;
  const label = name.slice(0, -suffix.length);
  if (!label || label.includes(".")) return false;
  const slug = normaliseSlug(label);
  if (!slug || slug !== label) return false;
  try {
    return statSync(dirFor(slug)).isDirectory();
  } catch {
    return false;
  }
}

export function readManifest(slug: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(dirFor(slug), MANIFEST), "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export interface PublishResult {
  ok: boolean;
  slug?: string;
  url?: string;
  message?: string;
  /** Set when the wanted address was taken and a free one was used instead. */
  renamedFrom?: string;
}

// --- is this address free? ---------------------------------------------------
//
// A published app is named by its owner, and the name is a hostname everybody
// shares. Before this, the only way to find out a name was taken was to upload
// the whole app and read a 400 back, which is why two people who both left a
// project called "Untitled app" met a dead end instead of an address.

export type SlugState = "free" | "yours" | "taken" | "unusable";

export interface SlugStatus {
  /** The address as it would be used, or null when the name cannot be one. */
  slug: string | null;
  state: SlugState;
  reason?: "invalid" | "reserved";
  message?: string;
}

export function slugStatus(raw: string, owner: string): SlugStatus {
  const label = cleanLabel(raw);
  if (RESERVED.has(label)) {
    return {
      slug: null,
      state: "unusable",
      reason: "reserved",
      message: `"${label}" is kept for DevStation itself. Try another name.`,
    };
  }
  const slug = normaliseSlug(raw);
  if (!slug) {
    return {
      slug: null,
      state: "unusable",
      reason: "invalid",
      message: "Use 2 to 40 letters, numbers or hyphens. Digits alone will not do.",
    };
  }
  const manifest = readManifest(slug);
  if (!manifest) return { slug, state: "free" };
  if (manifest.owner.toLowerCase() === owner.toLowerCase()) {
    return { slug, state: "yours", message: "Your app is already here. Publishing replaces it." };
  }
  return { slug, state: "taken", message: "That address is taken by another wallet." };
}

/** Free addresses near the wanted one. The wallet-tailed suggestion is there so
 *  a popular name does not turn everybody into -2, -3, -4. */
export function suggestSlugs(raw: string, owner: string, count = 3): string[] {
  const base = cleanLabel(raw).slice(0, 34).replace(/-+$/, "") || "my-app";
  const tail = /^0x[a-fA-F0-9]{40}$/.test(owner) ? owner.slice(2, 6).toLowerCase() : "";
  const candidates = [
    `${base}-2`,
    `${base}-3`,
    ...(tail ? [`${base}-${tail}`] : []),
    `${base}-app`,
    `${base}-live`,
    ...[4, 5, 6, 7, 8, 9].map((n) => `${base}-${n}`),
  ];
  const out: string[] = [];
  for (const candidate of candidates) {
    if (out.length >= count) break;
    const status = slugStatus(candidate, owner);
    if (status.slug && status.state === "free" && !out.includes(status.slug)) out.push(status.slug);
  }
  return out;
}

/** The wanted address when it can be had, otherwise the nearest free one. */
export function firstFreeSlug(raw: string, owner: string): string | null {
  const status = slugStatus(raw, owner);
  if (status.slug && (status.state === "free" || status.state === "yours")) return status.slug;
  return suggestSlugs(raw, owner, 1)[0] ?? null;
}

/** Rejects anything that would escape the site directory. A published app is
 *  arbitrary user content, so the path is treated as hostile input. */
function safeTarget(root: string, path: string): string | null {
  if (!path || path.startsWith("/") || path.includes("\\")) return null;
  if (path.split("/").some((p) => p === ".." || p === "." || p === "")) return null;
  const full = resolve(root, path);
  if (full !== root && !full.startsWith(root + "/")) return null;
  return full;
}

export function publishSite(input: {
  slug: string;
  files: Record<string, string>;
  owner: string;
  /** Publish at a free address rather than failing when the wanted one is
   *  taken. The caller is told which address was used. */
  fallback?: boolean;
}): PublishResult {
  let slug = normaliseSlug(input.slug);
  if (!slug) {
    return {
      ok: false,
      message: "That name cannot be used. Try 2-40 letters, numbers or hyphens.",
    };
  }
  const paths = Object.keys(input.files);
  if (paths.length === 0) return { ok: false, message: "There is nothing to publish yet." };
  if (paths.length > MAX_PUBLISH_FILES) {
    return { ok: false, message: `Too many files (limit ${MAX_PUBLISH_FILES}).` };
  }
  const bytes = Object.values(input.files).reduce((n, c) => n + Buffer.byteLength(c), 0);
  if (bytes > MAX_PUBLISH_BYTES) {
    return { ok: false, message: "That app is too large to publish (limit 10 MB)." };
  }
  if (!paths.some((p) => p === "index.html" || p.endsWith("/index.html"))) {
    return { ok: false, message: "A published app needs an index.html." };
  }

  let renamedFrom: string | undefined;
  const claimed = readManifest(slug);
  if (claimed && claimed.owner.toLowerCase() !== input.owner.toLowerCase()) {
    if (!input.fallback) return { ok: false, message: "That name is taken by another wallet." };
    const free = suggestSlugs(slug, input.owner, 1)[0];
    if (!free) {
      return {
        ok: false,
        message: "That name is taken, and no address near it is free. Try a different one.",
      };
    }
    renamedFrom = slug;
    slug = free;
  }
  const existing = readManifest(slug);

  // Build the new version beside the live one and swap it in. A publish that
  // fails halfway must not leave a half-replaced site being served.
  const target = dirFor(slug);
  const staging = `${target}.incoming-${Date.now()}`;
  try {
    mkdirSync(staging, { recursive: true });
    for (const [path, content] of Object.entries(input.files)) {
      const full = safeTarget(staging, path);
      if (!full) {
        rmSync(staging, { recursive: true, force: true });
        return { ok: false, message: `Refusing to write outside the site: ${path}` };
      }
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf8");
    }
    const now = Date.now();
    const manifest: Manifest = {
      slug,
      owner: input.owner,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      fileCount: paths.length,
      bytes,
    };
    writeFileSync(join(staging, MANIFEST), JSON.stringify(manifest), "utf8");

    const retired = `${target}.retired-${Date.now()}`;
    if (existsSync(target)) cpSync(target, retired, { recursive: true });
    rmSync(target, { recursive: true, force: true });
    cpSync(staging, target, { recursive: true });
    rmSync(staging, { recursive: true, force: true });
    rmSync(retired, { recursive: true, force: true });
    return { ok: true, slug, url: `https://${slug}.devstation.online`, renamedFrom };
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    return { ok: false, message: e instanceof Error ? e.message : "The publish failed." };
  }
}

/** Sites owned by a wallet, for "my published apps". */
export function sitesFor(owner: string): Manifest[] {
  try {
    return readdirSync(PUBLISH_DIR)
      .map((slug) => readManifest(slug))
      .filter((m): m is Manifest => !!m && m.owner.toLowerCase() === owner.toLowerCase())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

/** How many sites each wallet has published, lowercased, for the leaderboard. */
export function siteCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  try {
    for (const slug of readdirSync(PUBLISH_DIR)) {
      const owner = readManifest(slug)?.owner?.toLowerCase();
      if (owner) counts[owner] = (counts[owner] ?? 0) + 1;
    }
  } catch {
    // Nothing published yet.
  }
  return counts;
}

export function unpublishSite(slug: string, owner: string): boolean {
  const clean = normaliseSlug(slug);
  if (!clean) return false;
  const manifest = readManifest(clean);
  if (!manifest || manifest.owner.toLowerCase() !== owner.toLowerCase()) return false;
  try {
    rmSync(dirFor(clean), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  json: "application/json; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  txt: "text/plain; charset=utf-8",
  map: "application/json; charset=utf-8",
};

export interface ServedFile {
  body: Buffer;
  contentType: string;
}

/** Resolve one request against a published site.
 *
 *  Everything here is user-uploaded content addressed by a user-supplied path,
 *  so the traversal check is the load-bearing part: the resolved path must stay
 *  inside the site directory, and the manifest is never served. */
export function serveFile(host: string, urlPath: string): ServedFile | null {
  if (!canServe(host)) return null;
  const slug = host
    .toLowerCase()
    .split(":")[0]
    .replace(/\.devstation\.online$/, "");
  const root = resolve(dirFor(slug));

  let rel = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  if (rel === MANIFEST || rel.endsWith(`/${MANIFEST}`)) return null;

  let full = safeTarget(root, rel);
  // A single-page app routes client-side, so an unknown path is not a 404 -
  // it is the app's own router being asked to handle it.
  if (!full || !existsSync(full) || !statSync(full).isFile()) {
    full = safeTarget(root, "index.html");
    rel = "index.html";
    if (!full || !existsSync(full)) return null;
  }
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  return { body: readFileSync(full), contentType: TYPES[ext] ?? "application/octet-stream" };
}
