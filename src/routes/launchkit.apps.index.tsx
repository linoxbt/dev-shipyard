import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Check, Code2, Pencil, Plus, Trash2, Wand2, X } from "lucide-react";
import { useAccount } from "wagmi";
import { fileCount, useProjects, type AppProject } from "@/lib/appgen/projects";

// Every app you have built, and the way back into one.
//
// The App Builder used to hold a single unnamed workspace in React state:
// starting a second app replaced the first, and a refresh lost both. This is
// the list that makes them real things you can come back to.

export const Route = createFileRoute("/launchkit/apps/")({
  head: () => ({ meta: [{ title: "Apps: DevStation" }] }),
  component: AppsPage,
});

function when(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

function AppsPage() {
  const navigate = useNavigate();
  const { address: wallet } = useAccount();
  const { projects, hydrate, create, open, rename, remove } = useProjects();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Read storage after mount, never during render, so the server and the first
  // client render agree.
  useEffect(() => hydrate(), [hydrate]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const openProject = (id: string) => {
    open(id);
    void navigate({ to: "/launchkit/app-builder" });
  };

  const startNew = () => {
    create(undefined, wallet ?? null);
    void navigate({ to: "/launchkit/app-builder" });
  };

  const commitRename = (p: AppProject) => {
    rename(p.id, draft);
    setEditing(null);
  };

  return (
    <div className="mx-auto max-w-4xl py-6 px-5 sm:px-8 lg:px-12">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-mono text-sm font-bold text-foreground">Apps</h1>
          <p className="mt-0.5 font-mono text-[11px] text-meta">
            Everything you have built here. Files and the conversation are kept together.
          </p>
        </div>
        <button
          onClick={startNew}
          className="inline-flex shrink-0 items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          <Plus className="h-3.5 w-3.5" /> New app
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="rounded border border-dashed border-border p-10 text-center">
          <Wand2 className="mx-auto h-5 w-5 text-meta" />
          <p className="mt-3 font-mono text-xs text-muted-foreground">No apps yet.</p>
          <p className="mt-1 font-mono text-[11px] text-meta">
            Describe what you want and DevStation builds it, then keep talking to change it.
          </p>
          <button
            onClick={startNew}
            className="mt-4 inline-flex items-center gap-1.5 rounded border border-primary px-3 py-1.5 font-mono text-[11px] text-primary hover:bg-primary/10"
          >
            <Plus className="h-3 w-3" /> Start one
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {projects.map((p) => (
            <li
              key={p.id}
              className="group flex items-center gap-3 rounded border border-border bg-surface px-3 py-2.5 transition hover:border-primary/50"
            >
              {editing === p.id ? (
                <>
                  <input
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p);
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-primary bg-background px-2 py-1 font-mono text-xs text-foreground focus:outline-none"
                  />
                  <button
                    onClick={() => commitRename(p)}
                    title="Save"
                    className="text-meta hover:text-success"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    title="Cancel"
                    className="text-meta hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <>
                  {/* Clicking an app opens its details, who built it, what is
                      in it, where it is published. Going straight to the
                      builder skipped all of that, so the builder is now an
                      explicit action rather than the only destination. */}
                  <Link
                    to="/launchkit/apps/$id"
                    params={{ id: p.id }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate font-mono text-xs font-medium text-foreground">
                      {p.name}
                    </div>
                    <div className="mt-0.5 font-mono text-[10px] text-meta">
                      {fileCount(p)} files · {p.history.length} messages · {when(p.updatedAt)}
                    </div>
                  </Link>

                  {confirming === p.id ? (
                    <>
                      <span className="font-mono text-[10px] text-danger">Delete?</span>
                      <button
                        onClick={() => {
                          remove(p.id);
                          setConfirming(null);
                        }}
                        className="rounded border border-danger px-2 py-0.5 font-mono text-[10px] text-danger hover:bg-danger/10"
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        className="font-mono text-[10px] text-meta hover:text-foreground"
                      >
                        No
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => openProject(p.id)}
                        title="Open in builder"
                        className="text-meta opacity-0 transition group-hover:opacity-100 hover:text-primary"
                      >
                        <Code2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          setDraft(p.name);
                          setEditing(p.id);
                        }}
                        title="Rename"
                        className="text-meta opacity-0 transition group-hover:opacity-100 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirming(p.id)}
                        title="Delete"
                        className="text-meta opacity-0 transition group-hover:opacity-100 hover:text-danger"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 font-mono text-[10px] text-meta">
        Stored in this browser.{" "}
        <Link to="/launchkit/app-builder" className="text-primary hover:underline">
          Open the builder
        </Link>
      </p>
    </div>
  );
}
