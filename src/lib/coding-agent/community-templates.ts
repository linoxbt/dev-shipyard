import { useEffect, useState } from "react";
import { gunzip } from "@/lib/appgen/project-sync";

// Community templates on the Templates tab: apps people built here that an
// admin picked (routes/api.templates.ts). The list is light; each template's
// files are fetched when its card comes into view or it is opened, once per
// version.

export interface CommunityTemplate {
  id: string;
  name: string;
  blurb: string;
  files: number;
  size: number;
  version: string;
}

export interface TemplateSnapshot {
  files: Record<string, string>;
  dist: Record<string, string> | null;
}

const textMap = (v: unknown): Record<string, string> => {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v as Record<string, unknown>)) {
    if (typeof t === "string") out[k] = t;
  }
  return out;
};

/** A {files, dist} body as the server sends it, checked on the way in. */
export async function decodeSnapshot(body: string): Promise<TemplateSnapshot | null> {
  try {
    const raw = JSON.parse(await gunzip(body)) as { files?: unknown; dist?: unknown };
    const dist = textMap(raw.dist);
    return { files: textMap(raw.files), dist: Object.keys(dist).length ? dist : null };
  } catch {
    return null;
  }
}

const bodies = new Map<string, Promise<TemplateSnapshot | null>>();

async function fetchSnapshot(url: string): Promise<TemplateSnapshot | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  const data = (await res.json().catch(() => null)) as { ok?: boolean; body?: string } | null;
  if (!res.ok || !data?.body) return null;
  return decodeSnapshot(data.body);
}

function cached(key: string, url: string): Promise<TemplateSnapshot | null> {
  let p = bodies.get(key);
  if (!p) {
    p = fetchSnapshot(url).catch(() => null);
    bodies.set(key, p);
    // A failure is not kept: the next look tries again.
    void p.then((s) => {
      if (!s) bodies.delete(key);
    });
  }
  return p;
}

/** A community template's files. */
export function templateSnapshot(t: Pick<CommunityTemplate, "id" | "version">) {
  return cached(
    `t:${t.id}:${t.version}`,
    `/api/templates?id=${encodeURIComponent(t.id)}&v=${encodeURIComponent(t.version)}`,
  );
}

/** The snapshot behind `load`, once `enabled`. */
export function useSnapshot(
  load: (() => Promise<TemplateSnapshot | null>) | null,
  key: string,
): TemplateSnapshot | null | undefined {
  const [state, setState] = useState<{ key: string; snap: TemplateSnapshot | null } | null>(null);
  useEffect(() => {
    if (!load) return;
    let live = true;
    void load().then((snap) => live && setState({ key, snap }));
    return () => {
      live = false;
    };
    // `key` names what `load` loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!load]);
  return state?.key === key ? state.snap : undefined;
}

let listed: Promise<CommunityTemplate[]> | null = null;

export function fetchCommunityTemplates(fresh = false): Promise<CommunityTemplate[]> {
  if (!listed || fresh) {
    listed = fetch("/api/templates")
      .then((r) => r.json())
      .then((d: { templates?: CommunityTemplate[] }) =>
        Array.isArray(d?.templates) ? d.templates : [],
      )
      .catch(() => {
        listed = null;
        return [];
      });
  }
  return listed;
}

/** The community templates, in the admin's order (empty until loaded). */
export function useCommunityTemplates(): CommunityTemplate[] {
  const [list, setList] = useState<CommunityTemplate[]>([]);
  useEffect(() => {
    let live = true;
    void fetchCommunityTemplates().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  return list;
}
