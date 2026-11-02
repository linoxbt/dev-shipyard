import { fetchWithGrant } from "@/lib/agent-access/grant";
import { onProjectRemoved, parseProject, useProjects, type AppProject } from "./projects";

// Projects follow the account, not the browser.
//
// Each project the signed-in account owns is saved to DevStation's server
// (api/projects) a moment after it changes: the chat, the files, the build and
// the screenshots, gzipped. Signing in anywhere else brings them all down, and
// a project changed on one device reaches the others within seconds of them
// looking (on focus, and every half minute while open).
//
// The newest version of a project wins, by its updatedAt: the server keeps the
// stored version when an older one arrives, so two devices never roll each
// other back. Deleting a project deletes it everywhere. Browser storage stays
// the fast copy the page opens from, so nothing waits on the network.

/** What this browser knows the server holds: id → updatedAt, per account. */
const SYNCED_KEY = "devstation-synced-v1";
/** Projects deleted here that the server may not know about yet: id → when. */
const DELETED_KEY = "devstation-deleted-v1";

const PUSH_DELAY_MS = 1_500;
const PULL_EVERY_MS = 30_000;
/** Matches api/projects: what one request may carry. */
const MAX_BODY_CHARS = 4_200_000;

type Stamps = Record<string, number>;

function load(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Bookkeeping only: at worst a project is sent once more than needed.
  }
}

function stamps(value: unknown): Stamps {
  const out: Stamps = {};
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
  }
  return out;
}

// Recorded whether or not anyone is signed in, so a project deleted while
// signed out is deleted everywhere at the next sign-in rather than coming back.
if (typeof window !== "undefined") {
  onProjectRemoved((id) => {
    const deleted = stamps(load(DELETED_KEY));
    deleted[id] = Date.now();
    save(DELETED_KEY, deleted);
    active?.removed(id);
  });
}

// ---------------------------------------------------------------- encoding

async function gzip(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

async function gunzip(base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/** Lighter versions of a project, tried in turn when one is too large to
 *  send: older screenshots first, then every picture, then the build (which
 *  the project's machine makes again). The conversation and the files are
 *  never dropped. */
export function lighterVersions(p: AppProject): AppProject[] {
  const noPictures = (keepLast: number) => ({
    ...p,
    turns: p.turns.map((t, i) =>
      i >= p.turns.length - keepLast
        ? t
        : {
            ...t,
            images: undefined,
            ...(t.steps ? { steps: t.steps.map(({ shot: _s, ...rest }) => rest) } : {}),
          },
    ),
  });
  return [p, noPictures(6), noPictures(0), { ...noPictures(0), dist: null }];
}

export async function encodeProject(p: AppProject): Promise<string | null> {
  for (const version of lighterVersions(p)) {
    const body = await gzip(JSON.stringify(version));
    if (body.length <= MAX_BODY_CHARS) return body;
  }
  return null;
}

export async function decodeProject(body: string): Promise<AppProject | null> {
  try {
    return parseProject(JSON.parse(await gunzip(body)));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the loop

interface Session {
  removed: (id: string) => void;
  stop: () => void;
}

let active: Session | null = null;

/**
 * Keep the projects `email` owns in step with the server. Returns the stop
 * function (for sign-out). Projects made here before signing in become this
 * account's.
 */
export function startProjectSync(
  email: string,
  opts: {
    onTooLarge?: (name: string) => void;
    pushDelayMs?: number;
    /** How requests are made: the signed-in session by default. */
    fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  } = {},
): () => void {
  active?.stop();
  const request = opts.fetch ?? fetchWithGrant;
  const who = email.toLowerCase();
  const allSynced = load(SYNCED_KEY);
  const synced = stamps(allSynced[who]);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const tooLarge = new Set<string>();
  let stopped = false;
  let pulling: Promise<void> | null = null;
  let available = true;

  const remember = (id: string, at: number | null) => {
    if (at === null) delete synced[id];
    else synced[id] = at;
    const all = load(SYNCED_KEY);
    all[who] = synced;
    save(SYNCED_KEY, all);
  };
  const mine = (p: AppProject) => (p.owner ?? "").toLowerCase() === who;

  async function push(id: string): Promise<void> {
    timers.delete(id);
    if (stopped || !available) return;
    const p = useProjects.getState().projects.find((x) => x.id === id);
    if (!p || !mine(p) || (synced[id] ?? 0) >= p.updatedAt) return;
    const body = await encodeProject(p);
    if (!body) {
      if (!tooLarge.has(id)) {
        tooLarge.add(id);
        opts.onTooLarge?.(p.name);
      }
      return;
    }
    const res = await send({ id, name: p.name, updatedAt: p.updatedAt, body });
    if (res?.applied) remember(id, p.updatedAt);
    // A newer version from another device is stored: take that one.
    else if (res && res.stored > p.updatedAt) await pull();
  }

  function schedule(id: string) {
    const old = timers.get(id);
    if (old) clearTimeout(old);
    timers.set(
      id,
      setTimeout(() => void push(id).catch(() => undefined), opts.pushDelayMs ?? PUSH_DELAY_MS),
    );
  }

  async function send(payload: Record<string, unknown>): Promise<{
    applied: boolean;
    stored: number;
  } | null> {
    try {
      const res = await request("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 503) available = false;
      if (!res.ok) return null;
      const data = (await res.json()) as { applied?: boolean; stored?: number };
      return { applied: !!data.applied, stored: Number(data.stored) || 0 };
    } catch {
      return null;
    }
  }

  async function deleteRemote(id: string, at: number): Promise<void> {
    const res = await send({ id, updatedAt: at, deleted: true });
    if (res) {
      remember(id, Math.max(at, res.stored));
      const deleted = stamps(load(DELETED_KEY));
      delete deleted[id];
      save(DELETED_KEY, deleted);
    }
  }

  async function pullOnce(): Promise<void> {
    if (stopped || !available) return;
    let list: { id: string; updatedAt: number; deleted: boolean }[];
    try {
      const res = await request("/api/projects");
      if (res.status === 503) {
        available = false;
        return;
      }
      if (!res.ok) return;
      list = ((await res.json()) as { projects?: typeof list }).projects ?? [];
    } catch {
      return;
    }
    if (stopped) return;

    const store = useProjects.getState();
    const local = new Map(store.projects.map((p) => [p.id, p]));
    const deletedHere = stamps(load(DELETED_KEY));
    const incoming: AppProject[] = [];
    const gone: string[] = [];
    const seen = new Set<string>();

    for (const r of list) {
      seen.add(r.id);
      const here = local.get(r.id);
      const deletedAt = deletedHere[r.id];
      if (deletedAt !== undefined) {
        // Deleted in this browser: tell the server, unless a later version
        // was saved elsewhere after it, which then comes back.
        if (deletedAt >= r.updatedAt && !r.deleted) {
          await deleteRemote(r.id, deletedAt);
          continue;
        }
        const d = stamps(load(DELETED_KEY));
        delete d[r.id];
        save(DELETED_KEY, d);
        if (r.deleted) continue;
      }
      if (r.deleted) {
        if (here && here.updatedAt <= r.updatedAt) gone.push(r.id);
        remember(r.id, r.updatedAt);
        continue;
      }
      if (!here || here.updatedAt < r.updatedAt) {
        const fetched = await fetchOne(r.id);
        if (fetched) {
          incoming.push(fetched);
          remember(r.id, fetched.updatedAt);
        }
      } else if (here.updatedAt > r.updatedAt) {
        if (mine(here)) schedule(r.id);
      } else {
        remember(r.id, r.updatedAt);
      }
    }
    // Projects the server has never had: this account's, made here.
    for (const p of store.projects) {
      if (!seen.has(p.id) && mine(p)) {
        if (synced[p.id] !== undefined) remember(p.id, null);
        schedule(p.id);
      }
    }
    // Deletions made here of projects the server never had need nothing.
    if (!stopped) useProjects.getState().mergeRemote(incoming, gone);
  }

  async function fetchOne(id: string): Promise<AppProject | null> {
    try {
      const res = await request(`/api/projects?id=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const data = (await res.json()) as { body?: string | null };
      if (!data.body) return null;
      const p = await decodeProject(data.body);
      return p && p.id === id ? { ...p, owner: p.owner ?? who } : null;
    } catch {
      return null;
    }
  }

  function pull(): Promise<void> {
    if (!pulling) {
      pulling = pullOnce().finally(() => {
        pulling = null;
      });
    }
    return pulling;
  }

  // Work made here before signing in becomes this account's.
  const unowned = useProjects.getState().projects.filter((p) => !p.owner);
  for (const p of unowned) useProjects.getState().update(p.id, { owner: email });

  // Every change to one of this account's projects is sent shortly after.
  const unsubscribe = useProjects.subscribe((state, prev) => {
    if (state.projects === prev.projects) return;
    for (const p of state.projects) {
      if (mine(p) && (synced[p.id] ?? 0) < p.updatedAt) schedule(p.id);
    }
  });

  const onFocus = () => {
    if (document.visibilityState === "visible") void pull();
  };
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onFocus);
  const interval = setInterval(() => {
    if (document.visibilityState === "visible") void pull();
  }, PULL_EVERY_MS);

  // Wait for this browser's own copy before comparing against the server.
  const begin = () => void pull();
  if (useProjects.getState().hydrated) begin();
  else {
    const off = useProjects.subscribe((s) => {
      if (s.hydrated) {
        off();
        begin();
      }
    });
  }

  const session: Session = {
    removed: (id) => {
      const t = timers.get(id);
      if (t) clearTimeout(t);
      timers.delete(id);
      if (synced[id] !== undefined) {
        void deleteRemote(id, Date.now()).catch(() => undefined);
      } else {
        // Never saved to the server: nothing to delete there.
        const deleted = stamps(load(DELETED_KEY));
        delete deleted[id];
        save(DELETED_KEY, deleted);
      }
    },
    stop: () => {
      stopped = true;
      unsubscribe();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if (active === session) active = null;
    },
  };
  active = session;
  return session.stop;
}
