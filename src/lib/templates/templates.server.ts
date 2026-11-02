import { gunzipSync, gzipSync } from "node:zlib";
import { insertReturning, remove, select, update } from "@/lib/db/admin.server";
import { pseudonym } from "@/lib/db/stats.server";

// Community templates: apps people built here that an admin has put on the
// Templates tab. The admin browses every account's saved projects
// (saved_projects), looks at one running, and features it; featuring copies
// the project's files and build into app_templates, without the conversation
// or anything private, so what people open is fixed until an admin refreshes
// it from the builder's latest version.

export interface Snapshot {
  files: Record<string, string>;
  dist: Record<string, string> | null;
}

export interface TemplateRow {
  id: string;
  name: string;
  blurb: string;
  source_owner: string;
  source_project: string;
  body?: string;
  size: number;
  files: number;
  position: number;
  created_at: string;
  updated_at: string;
}

/** A body is at most this long, like a saved project's. */
export const MAX_TEMPLATE_CHARS = 4_200_000;

/** Files a template never carries: secrets, the agent's own notes about the
 *  project, the builder's uploads and anything installed. */
const PRIVATE = [
  /(^|\/)\.env($|\.)/i,
  /(^|\/)\.devstation\//,
  /(^|\/)\.agent\//,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /^attachments\//,
  /(^|\/)\.npmrc$/,
  /(^|\/)id_(rsa|ed25519)/,
];

export const isPrivatePath = (path: string): boolean => PRIVATE.some((re) => re.test(path));

function textMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, string> = {};
  for (const [path, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text !== "string" || !path || path.includes("..") || path.startsWith("/")) continue;
    if (isPrivatePath(path)) continue;
    out[path] = text;
  }
  return out;
}

/** The parts of a saved project a template keeps. */
export function snapshotOf(project: unknown): Snapshot {
  const p = (project ?? {}) as { files?: unknown; dist?: unknown };
  const dist = textMap(p.dist);
  return { files: textMap(p.files), dist: Object.keys(dist).length ? dist : null };
}

export function encodeBody(value: unknown): string {
  return gzipSync(Buffer.from(JSON.stringify(value))).toString("base64");
}

export function decodeBody(body: string): unknown {
  try {
    return JSON.parse(gunzipSync(Buffer.from(body, "base64")).toString("utf8"));
  } catch {
    return null;
  }
}

/** Whether a snapshot has something to show. */
export const hasApp = (s: Snapshot): boolean =>
  Object.keys(s.dist ?? {}).length > 0 || Object.keys(s.files).length > 0;

// ------------------------------------------------------------ the community

interface SavedRow {
  owner: string;
  id: string;
  name: string;
  updated_at: number | string;
  size: number;
  body?: string | null;
}

export interface CommunityProject {
  /** owner:id, which the admin sends back to look at or feature it. */
  ref: string;
  builder: string;
  name: string;
  updatedAt: number;
  size: number;
  template: string | null;
}

export function parseRef(ref: string): { owner: string; id: string } | null {
  const m = /^(0x[0-9a-fA-F]{40}):([A-Za-z0-9_-]{1,80})$/.exec(ref);
  return m ? { owner: m[1].toLowerCase(), id: m[2] } : null;
}

/** Saved projects across every account, newest first. */
export async function communityProjects(opts: {
  q?: string;
  offset?: number;
  limit?: number;
}): Promise<{ projects: CommunityProject[]; more: boolean }> {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 60);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = (opts.q ?? "")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 60);
  const filter = [
    "select=owner,id,name,updated_at,size",
    "deleted=eq.false",
    // An empty project's body is a few hundred characters.
    "size=gt.600",
    q ? `name=ilike.${encodeURIComponent(`*${q}*`)}` : "",
    "order=updated_at.desc",
    `limit=${limit + 1}`,
    `offset=${offset}`,
  ].filter(Boolean);
  const [rows, featured] = await Promise.all([
    select<SavedRow>("saved_projects", filter.join("&")),
    select<Pick<TemplateRow, "id" | "source_owner" | "source_project">>(
      "app_templates",
      "select=id,source_owner,source_project",
    ),
  ]);
  const byRef = new Map(featured.map((t) => [`${t.source_owner}:${t.source_project}`, t.id]));
  return {
    more: rows.length > limit,
    projects: rows.slice(0, limit).map((r) => ({
      ref: `${r.owner}:${r.id}`,
      builder: pseudonym(r.owner),
      name: r.name || "Untitled",
      updatedAt: Number(r.updated_at),
      size: r.size,
      template: byRef.get(`${r.owner}:${r.id}`) ?? null,
    })),
  };
}

/** A community project's files and build, as a template would carry them. */
export async function communitySnapshot(ref: string): Promise<Snapshot | null> {
  const at = parseRef(ref);
  if (!at) return null;
  const [row] = await select<SavedRow>(
    "saved_projects",
    `select=body&owner=eq.${encodeURIComponent(at.owner)}&id=eq.${encodeURIComponent(at.id)}&deleted=eq.false`,
  );
  if (!row?.body) return null;
  const project = decodeBody(row.body);
  return project ? snapshotOf(project) : null;
}

// ------------------------------------------------------------ the templates

export interface TemplateView {
  id: string;
  name: string;
  blurb: string;
  files: number;
  size: number;
  /** Changes whenever the template's files do, so a cached copy is replaced. */
  version: string;
}

export const templateView = (t: TemplateRow): TemplateView => ({
  id: t.id,
  name: t.name,
  blurb: t.blurb,
  files: t.files,
  size: t.size,
  version: String(Date.parse(t.updated_at) || 0),
});

export async function listTemplates(): Promise<TemplateRow[]> {
  return select<TemplateRow>(
    "app_templates",
    "select=id,name,blurb,source_owner,source_project,size,files,position,created_at,updated_at&order=position.asc,created_at.asc",
  );
}

/** A template's body: {files, dist}, gzipped and base64-encoded. */
export async function templateBody(id: string): Promise<string | null> {
  const [row] = await select<TemplateRow>(
    "app_templates",
    `select=body&id=eq.${encodeURIComponent(id)}`,
  );
  return row?.body ?? null;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string; status: number };

function packed(s: Snapshot): Result<{ body: string; files: number }> {
  if (!hasApp(s)) {
    return { ok: false, status: 422, message: "That project has no files to make a template of." };
  }
  const body = encodeBody(s);
  if (body.length > MAX_TEMPLATE_CHARS) {
    return { ok: false, status: 413, message: "That project is too large to be a template." };
  }
  return { ok: true, value: { body, files: Object.keys(s.dist ?? s.files).length } };
}

/** Put a community project on the Templates tab (last in the order). */
export async function featureProject(input: {
  ref: string;
  name: string;
  blurb: string;
  by: string;
}): Promise<Result<TemplateRow>> {
  const at = parseRef(input.ref);
  if (!at) return { ok: false, status: 400, message: "That is not a project." };
  const snap = await communitySnapshot(input.ref);
  if (!snap) return { ok: false, status: 404, message: "That project is gone or empty." };
  const pack = packed(snap);
  if (!pack.ok) return pack;
  const existing = await listTemplates();
  if (existing.some((t) => t.source_owner === at.owner && t.source_project === at.id)) {
    return { ok: false, status: 409, message: "That project is already a template." };
  }
  const row = await insertReturning<TemplateRow>("app_templates", {
    name: input.name,
    blurb: input.blurb,
    source_owner: at.owner,
    source_project: at.id,
    body: pack.value.body,
    size: pack.value.body.length,
    files: pack.value.files,
    position: existing.reduce((m, t) => Math.max(m, t.position), 0) + 1,
    created_by: input.by,
  });
  return row
    ? { ok: true, value: row }
    : { ok: false, status: 502, message: "The template was not saved." };
}

/** Copy the builder's latest version into the template again. */
export async function refreshTemplate(id: string): Promise<Result<TemplateRow>> {
  const [row] = await select<TemplateRow>(
    "app_templates",
    `select=source_owner,source_project&id=eq.${encodeURIComponent(id)}`,
  );
  if (!row) return { ok: false, status: 404, message: "That template is gone." };
  const snap = await communitySnapshot(`${row.source_owner}:${row.source_project}`);
  if (!snap) {
    return {
      ok: false,
      status: 404,
      message: "The builder deleted that project. The template keeps the copy it has.",
    };
  }
  const pack = packed(snap);
  if (!pack.ok) return pack;
  const [saved] = await update<TemplateRow>("app_templates", `id=eq.${encodeURIComponent(id)}`, {
    body: pack.value.body,
    size: pack.value.body.length,
    files: pack.value.files,
    updated_at: new Date().toISOString(),
  });
  return saved
    ? { ok: true, value: saved }
    : { ok: false, status: 404, message: "That template is gone." };
}

export async function editTemplate(
  id: string,
  patch: { name?: string; blurb?: string },
): Promise<TemplateRow | null> {
  const [saved] = await update<TemplateRow>(
    "app_templates",
    `id=eq.${encodeURIComponent(id)}`,
    patch,
  );
  return saved ?? null;
}

/** Move a template one place up or down. */
export async function moveTemplate(id: string, by: -1 | 1): Promise<void> {
  const all = await listTemplates();
  const i = all.findIndex((t) => t.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  // Renumber the whole list, so equal or missing positions sort out too.
  await Promise.all(
    all.map((t, n) =>
      t.position === n + 1
        ? null
        : update("app_templates", `id=eq.${encodeURIComponent(t.id)}`, { position: n + 1 }),
    ),
  );
}

export async function removeTemplate(id: string): Promise<void> {
  await remove("app_templates", `id=eq.${encodeURIComponent(id)}`);
}
