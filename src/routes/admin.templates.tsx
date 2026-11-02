import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Card, Shell, Unavailable, when } from "@/components/stats/StatsDashboard";
import { RemoteThumb, SnapshotFrame } from "@/components/coding-agent/ProjectThumb";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import {
  decodeSnapshot,
  fetchCommunityTemplates,
  templateSnapshot,
  type TemplateSnapshot,
} from "@/lib/coding-agent/community-templates";
import { ago } from "@/lib/coding-agent/steps";
import { cn } from "@/lib/utils";

// Choosing what the community built for the Templates tab, for the accounts in
// ADMIN_EMAILS (api/admin/templates). Every account's saved projects are here,
// newest first, each running small; look at one full size, then add it with a
// name and a line about it. Adding copies its files and build, without the
// chat, so the template stays as it was until it is refreshed from the
// builder's latest version.

export const Route = createFileRoute("/admin/templates")({
  head: () => ({
    meta: [{ title: "Templates · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: TemplatesAdmin,
});

interface Community {
  ref: string;
  builder: string;
  name: string;
  updatedAt: number;
  size: number;
  template: string | null;
}

interface Chosen {
  id: string;
  ref: string;
  name: string;
  blurb: string;
  builder: string;
  files: number;
  size: number;
  version: string;
  createdAt: string;
  updatedAt: string;
}

interface Listing {
  projects: Community[];
  more: boolean;
  templates: Chosen[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithGrant(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "That did not work just now.");
  return body as T;
}

const post = <T,>(body: Record<string, unknown>) =>
  call<T>("/api/admin/templates", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** A project's files, for its card and the full-size look. */
function loadProject(ref: string): Promise<TemplateSnapshot | null> {
  return call<{ body: string }>(`/api/admin/templates?project=${encodeURIComponent(ref)}`)
    .then((d) => decodeSnapshot(d.body))
    .catch(() => null);
}

const projectCache = new Map<string, Promise<TemplateSnapshot | null>>();
function projectSnap(p: Pick<Community, "ref" | "updatedAt">) {
  const key = `${p.ref}:${p.updatedAt}`;
  let hit = projectCache.get(key);
  if (!hit) {
    hit = loadProject(p.ref);
    projectCache.set(key, hit);
    void hit.then((s) => !s && projectCache.delete(key));
  }
  return hit;
}

function TemplatesAdmin() {
  const [data, setData] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [looking, setLooking] = useState<{
    name: string;
    load: () => Promise<TemplateSnapshot | null>;
  } | null>(null);
  const [adding, setAdding] = useState<Community | null>(null);
  const [editing, setEditing] = useState<Chosen | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => useAuth.getState().init(), []);

  const load = useCallback(async (q: string, offset = 0) => {
    setLoading(true);
    try {
      const page = await call<Listing>(
        `/api/admin/templates?q=${encodeURIComponent(q)}&offset=${offset}`,
      );
      setData((prev) =>
        offset && prev ? { ...page, projects: [...prev.projects, ...page.projects] } : page,
      );
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!signedIn) {
      setError("Sign in on DevStation with an admin email, then open this page again.");
      return;
    }
    const t = setTimeout(() => void load(query), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [authReady, signedIn, query, load]);

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    try {
      await post(body);
      toast.success(done);
      void fetchCommunityTemplates(true);
      await load(query);
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const chosen = data?.templates ?? [];

  return (
    <Shell
      label="Templates"
      controls={
        <button
          onClick={() => void load(query)}
          disabled={loading}
          aria-label="Refresh"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      }
    >
      {error && !data ? (
        <Unavailable title="Templates are not available" message={error} />
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-[22px] font-semibold tracking-tight">Templates</h1>
            <p className="mt-1 max-w-2xl text-[13.5px] text-muted-foreground">
              Pick apps the community built and put them on the Templates tab, beside the built-in
              ones. A template is a copy of the app&apos;s files and build, without the
              conversation. It stays as it is until you refresh it from the builder&apos;s latest
              version.
            </p>
          </div>

          <Card
            title="On the Templates tab"
            note={
              chosen.length
                ? `${chosen.length} from the community, shown first, in this order`
                : "None yet. Add one from the community below."
            }
          >
            {!data ? (
              <div className="h-24 animate-pulse rounded-xl bg-surface-2" />
            ) : chosen.length === 0 ? (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                Only the built-in templates are showing.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {chosen.map((t, i) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
                    <button
                      onClick={() => setLooking({ name: t.name, load: () => templateSnapshot(t) })}
                      className="w-28 shrink-0 overflow-hidden rounded-lg border border-border"
                      aria-label={`Look at ${t.name}`}
                    >
                      <RemoteThumb
                        name={t.name}
                        cacheKey={`${t.id}:${t.version}`}
                        load={() => templateSnapshot(t)}
                      />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] font-medium">{t.name}</p>
                      <p className="truncate text-[12.5px] text-muted-foreground">
                        {t.blurb || "No description"}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-meta">
                        {t.builder} · {t.files} files · copied {when(t.updatedAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <IconButton
                        label="Move up"
                        disabled={i === 0 || !!busy}
                        onClick={() =>
                          void act(t.id, { action: "move", id: t.id, by: -1 }, "Moved up.")
                        }
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label="Move down"
                        disabled={i === chosen.length - 1 || !!busy}
                        onClick={() =>
                          void act(t.id, { action: "move", id: t.id, by: 1 }, "Moved down.")
                        }
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton label="Edit" disabled={!!busy} onClick={() => setEditing(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton
                        label="Refresh from the builder's latest version"
                        disabled={!!busy}
                        onClick={() =>
                          void act(
                            `r:${t.id}`,
                            { action: "refresh", id: t.id },
                            `${t.name} now has the builder's latest version.`,
                          )
                        }
                      >
                        <RefreshCw
                          className={cn("h-3.5 w-3.5", busy === `r:${t.id}` && "animate-spin")}
                        />
                      </IconButton>
                      <IconButton
                        label="Take off the Templates tab"
                        disabled={!!busy}
                        danger
                        onClick={() => {
                          if (!window.confirm(`Take ${t.name} off the Templates tab?`)) return;
                          void act(
                            t.id,
                            { action: "remove", id: t.id },
                            `${t.name} is off the Templates tab.`,
                          );
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </IconButton>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Built by the community" note="Every account's projects, newest first">
            <label className="relative mb-4 block max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by project name"
                className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13px] outline-none focus:border-primary"
              />
            </label>
            {!data ? (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="ds-skeleton aspect-[16/10] rounded-xl" />
                ))}
              </div>
            ) : data.projects.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">
                {query ? "No project has that name." : "Nobody has saved a project yet."}
              </p>
            ) : (
              <>
                <div className="grid gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
                  {data.projects.map((p) => (
                    <div key={p.ref}>
                      <button
                        onClick={() => setLooking({ name: p.name, load: () => projectSnap(p) })}
                        className="group relative block w-full overflow-hidden rounded-xl border border-border text-left transition hover:border-primary/40"
                        aria-label={`Look at ${p.name}`}
                      >
                        <RemoteThumb
                          name={p.name}
                          cacheKey={`${p.ref}:${p.updatedAt}`}
                          load={() => projectSnap(p)}
                        />
                        <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11.5px] font-medium opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">
                          <Eye className="h-3 w-3" /> Look
                        </span>
                      </button>
                      <div className="mt-2.5 flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium">{p.name}</p>
                          <p className="font-mono text-[11px] text-meta">
                            {p.builder} · {ago(p.updatedAt)}
                          </p>
                        </div>
                        {p.template ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-[11.5px] font-medium text-primary">
                            <Check className="h-3 w-3" /> On Templates
                          </span>
                        ) : (
                          <button
                            onClick={() => setAdding(p)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] font-medium transition hover:bg-surface-2"
                          >
                            <Plus className="h-3 w-3" /> Add to Templates
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {data.more && (
                  <div className="mt-6 flex justify-center">
                    <button
                      onClick={() => void load(query, data.projects.length)}
                      disabled={loading}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-[13px] transition hover:bg-surface-2 disabled:opacity-60"
                    >
                      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Show more
                    </button>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      )}

      {looking && <LookDialog {...looking} onClose={() => setLooking(null)} />}
      {adding && (
        <DetailsDialog
          title="Add to Templates"
          action="Add to Templates"
          initial={{ name: adding.name, blurb: "" }}
          onClose={() => setAdding(null)}
          onSave={async (v) => {
            const ok = await act(
              `a:${adding.ref}`,
              { action: "feature", ref: adding.ref, ...v },
              `${v.name} is on the Templates tab.`,
            );
            if (ok) setAdding(null);
          }}
          busy={busy === `a:${adding.ref}`}
        />
      )}
      {editing && (
        <DetailsDialog
          title="Edit template"
          action="Save"
          initial={{ name: editing.name, blurb: editing.blurb }}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            const ok = await act(editing.id, { action: "edit", id: editing.id, ...v }, "Saved.");
            if (ok) setEditing(null);
          }}
          busy={busy === editing.id}
        />
      )}
    </Shell>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        "grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-surface-2 disabled:opacity-40",
        danger ? "hover:text-danger" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Dialog({
  label,
  onClose,
  wide,
  children,
}: {
  label: string;
  onClose: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label={label}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex max-h-full w-full flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xl",
          wide ? "h-[85dvh] max-w-6xl" : "max-w-md",
        )}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-[14px] font-medium">{label}</p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function LookDialog({
  name,
  load,
  onClose,
}: {
  name: string;
  load: () => Promise<TemplateSnapshot | null>;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<TemplateSnapshot | null | undefined>(undefined);
  const loader = useRef(load);
  useEffect(() => {
    let live = true;
    void loader.current().then((s) => live && setSnap(s));
    return () => {
      live = false;
    };
  }, []);
  return (
    <Dialog label={name} onClose={onClose} wide>
      <div className="relative min-h-0 flex-1">
        {snap === undefined ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the app
          </div>
        ) : snap === null ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">
            This app could not be loaded.
          </div>
        ) : (
          <SnapshotFrame name={name} snap={snap} />
        )}
      </div>
    </Dialog>
  );
}

function DetailsDialog({
  title,
  action,
  initial,
  busy,
  onClose,
  onSave,
}: {
  title: string;
  action: string;
  initial: { name: string; blurb: string };
  busy: boolean;
  onClose: () => void;
  onSave: (v: { name: string; blurb: string }) => void | Promise<void>;
}) {
  const [name, setName] = useState(initial.name.slice(0, 80));
  const [blurb, setBlurb] = useState(initial.blurb);
  const ok = name.trim().length > 0;
  return (
    <Dialog label={title} onClose={onClose}>
      <form
        className="space-y-4 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok && !busy) void onSave({ name: name.trim(), blurb: blurb.trim() });
        }}
      >
        <label className="block">
          <span className="text-[12.5px] font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            autoFocus
            className="mt-1 h-9 w-full rounded-lg border border-border bg-background px-3 text-[13.5px] outline-none focus:border-primary"
          />
        </label>
        <label className="block">
          <span className="text-[12.5px] font-medium">What it is</span>
          <textarea
            value={blurb}
            onChange={(e) => setBlurb(e.target.value)}
            maxLength={240}
            rows={3}
            placeholder="One line people read on the card, e.g. A habit tracker with streaks and reminders."
            className="mt-1 w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] outline-none focus:border-primary"
          />
          <span className="mt-1 block text-right font-mono text-[10.5px] text-meta">
            {blurb.length}/240
          </span>
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-[13px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ok || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground disabled:opacity-60"
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {action}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
