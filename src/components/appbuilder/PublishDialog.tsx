import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Globe, Loader2, Rocket, X } from "lucide-react";
import { usePublishApp } from "@/hooks/usePublishApp";
import type { AppProject } from "@/lib/appgen/projects";

// Choosing the address an app goes live at.
//
// The address used to be the project's name, sent straight to the runner. Two
// people who both kept "Untitled app", or who cloned the same marketplace app,
// asked for the same hostname; the first got it and everybody after got a red
// toast with nowhere to go. Now the address is shown before anything is
// uploaded, checked as it is typed, and free alternatives are one click away.

const SUFFIX = ".devstation.online";

type SlugState = "free" | "yours" | "taken" | "unusable";

interface Availability {
  slug: string | null;
  state: SlugState;
  message?: string;
  suggestions: string[];
}

/** The same cleaning the runner does, so the field shows what will be used. */
function cleanAddress(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);
}

function addressOf(url: string | null | undefined): string {
  return url ? url.replace(/^https?:\/\//, "").split(".")[0] : "";
}

export function PublishDialog({
  project,
  files,
  onClose,
  onPublished,
}: {
  project: AppProject;
  /** What goes live: the built output, or the app's own folder. */
  files: Record<string, string>;
  onClose: () => void;
  onPublished?: (url: string) => void;
}) {
  const { publish, publishing } = usePublishApp();
  const current = addressOf(project.liveUrl);
  const [address, setAddress] = useState(() => current || cleanAddress(project.name) || "my-app");
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [done, setDone] = useState<{ url: string; renamedFrom?: string } | null>(null);
  // The first taken answer swaps in a distinct address, once, so a clash does
  // not leave the person to invent a name themselves.
  const suggested = useRef(false);

  useEffect(() => {
    const wanted = address.trim();
    if (!wanted) {
      setAvailability(null);
      return;
    }
    let alive = true;
    setChecking(true);
    const timer = setTimeout(() => {
      void (async () => {
        const res = await fetch(`/api/publish?slug=${encodeURIComponent(wanted)}`).catch(
          () => null,
        );
        const body = (await res?.json().catch(() => null)) as
          | ({ ok?: boolean } & Partial<Availability>)
          | null;
        if (!alive) return;
        setChecking(false);
        if (!body?.ok || !body.state) {
          setAvailability(null);
          return;
        }
        const next: Availability = {
          slug: body.slug ?? null,
          state: body.state,
          message: body.message,
          suggestions: body.suggestions ?? [],
        };
        setAvailability(next);
        if (next.state === "taken" && !suggested.current && next.suggestions[0]) {
          suggested.current = true;
          setAddress(next.suggestions[0]);
        }
      })();
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [address]);

  const fileCount = useMemo(() => Object.keys(files).length, [files]);
  const ready =
    !publishing && fileCount > 0 && !!availability?.slug && availability.state !== "unusable";

  const go = async () => {
    const result = await publish(project, { slug: address.trim(), files, fallback: true });
    if (result.ok && result.url) {
      setDone({ url: result.url, renamedFrom: result.renamedFrom });
      onPublished?.(result.url);
    }
  };

  if (done) {
    return (
      <Panel title="Live" onClose={onClose}>
        {done.renamedFrom && (
          <p className="mb-2 font-mono text-[11px] text-warning">
            {done.renamedFrom}
            {SUFFIX} was claimed while you were publishing, so this went live at the address below.
          </p>
        )}
        <a
          href={done.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-success hover:underline"
        >
          <Check className="h-3.5 w-3.5" /> {done.url.replace(/^https?:\/\//, "")}
          <ExternalLink className="h-3 w-3" />
        </a>
      </Panel>
    );
  }

  return (
    <Panel title={current ? "Republish this app" : "Publish this app"} onClose={onClose}>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          autoFocus
          value={address}
          onChange={(e) => setAddress(cleanAddress(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && ready) void go();
          }}
          spellCheck={false}
          aria-label="Address"
          className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
        />
        <span className="font-mono text-[11px] text-meta">{SUFFIX}</span>
        <button
          onClick={() => void go()}
          disabled={!ready}
          className="rounded bg-primary px-3 py-1 font-mono text-[10px] font-semibold text-primary-foreground disabled:opacity-40"
        >
          {publishing ? "Publishing…" : current ? "Republish" : "Publish"}
        </button>
      </div>

      <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px]">
        {checking ? (
          <span className="flex items-center gap-1.5 text-meta">
            <Loader2 className="h-3 w-3 animate-spin" /> Checking that address…
          </span>
        ) : !availability ? (
          <span className="text-meta">Type the address you want.</span>
        ) : availability.state === "free" ? (
          <span className="flex items-center gap-1 text-success">
            <Globe className="h-3 w-3" /> {availability.slug}
            {SUFFIX} is free.
          </span>
        ) : availability.state === "yours" ? (
          <span className="flex items-center gap-1 text-success">
            <Check className="h-3 w-3" /> Yours already. Publishing replaces what is there.
          </span>
        ) : (
          <span className="text-warning">
            {availability.message ?? "That address cannot be used."}
          </span>
        )}
      </p>

      {availability && availability.suggestions.length > 0 && availability.state !== "yours" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[10px] text-meta">Free:</span>
          {availability.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setAddress(s)}
              className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:border-primary hover:text-primary"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <p className="mt-2 font-mono text-[10px] leading-4 text-meta">
        {fileCount > 0
          ? `${fileCount} file${fileCount === 1 ? "" : "s"} go live at this address. Only your wallet can replace it.`
          : "There is nothing built to publish yet."}
        {current && ` Currently live at ${current}${SUFFIX}.`}
      </p>
    </Panel>
  );
}

function Panel({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Rocket className="h-3.5 w-3.5" /> {title}
        </p>
        <button onClick={onClose} className="text-meta hover:text-foreground" aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {children}
    </div>
  );
}
