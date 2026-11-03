import { useContext, useEffect, useState } from "react";
import { Download, ExternalLink, FileArchive, FileText, LoaderCircle, X } from "lucide-react";
import type { SharedMedia } from "@/lib/agent/media";
import { downloadRanges, MEDIA_CHUNK } from "@/lib/coding-agent/media-range";
import { ShotSource } from "@/lib/coding-agent/shots";
import { cn } from "@/lib/utils";

// A file the agent shared in the chat (its share_file tool): a video or a
// song plays right here, an image or a PDF opens, and anything can be
// downloaded. It streams from the project's own machine, so nothing has to be
// published for the person to see it.

function mediaUrl(workspaceId: string, id: string): string {
  return `/api/workspace?id=${encodeURIComponent(workspaceId)}&media=${encodeURIComponent(id)}`;
}

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Save a shared file: in one go when it is small, otherwise in ranges joined
 *  here (no single answer may be larger than MEDIA_CHUNK). */
async function save(url: string, media: SharedMedia, progress: (f: number) => void) {
  let blob: Blob;
  if (media.size <= MEDIA_CHUNK) {
    const res = await fetch(url);
    if (!res.ok) throw new Error("not available");
    blob = await res.blob();
  } else {
    const parts: Blob[] = [];
    const ranges = downloadRanges(media.size);
    for (let i = 0; i < ranges.length; i++) {
      const res = await fetch(url, { headers: { range: ranges[i] } });
      if (!res.ok) throw new Error("not available");
      parts.push(await res.blob());
      progress((i + 1) / ranges.length);
    }
    blob = new Blob(parts, { type: media.type });
  }
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = media.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export function MediaCard({ media }: { media: SharedMedia }) {
  const workspaceId = useContext(ShotSource);
  // Why it does not show: the file is gone, or this browser cannot play it.
  const [broken, setBroken] = useState<null | "gone" | "unplayable">(null);
  const [saving, setSaving] = useState<number | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!workspaceId) return null;
  const url = mediaUrl(workspaceId, media.id);

  const download = async () => {
    if (saving !== null) return;
    setSaveFailed(false);
    setSaving(0);
    try {
      await save(url, media, setSaving);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(null);
    }
  };

  const failed = () => {
    // Still there means this browser cannot play it; it can still be saved.
    void fetch(url, { headers: { range: "bytes=0-0" } })
      .then((r) => setBroken(r.ok ? "unplayable" : "gone"))
      .catch(() => setBroken("gone"));
  };

  const notShown = (
    <p className="px-3.5 py-6 text-center text-[13px] text-meta">
      {broken === "unplayable"
        ? "This browser cannot play this file. Download it to open it."
        : "This file is no longer available. Ask the agent to make it again."}
    </p>
  );

  return (
    <figure
      data-media={media.kind}
      className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-border bg-surface"
    >
      {broken ? (
        notShown
      ) : media.kind === "video" ? (
        <video
          src={url}
          controls
          playsInline
          preload="metadata"
          onError={failed}
          className="block max-h-[420px] w-full bg-black"
        />
      ) : media.kind === "audio" ? (
        <div className="px-3.5 pt-3.5">
          <audio src={url} controls preload="metadata" onError={failed} className="w-full" />
        </div>
      ) : media.kind === "image" ? (
        <button
          onClick={() => setOpen(true)}
          title="Open larger"
          className="block w-full bg-surface-2"
        >
          <img
            src={url}
            alt={media.caption || media.name}
            onError={failed}
            className="mx-auto block max-h-[420px] w-auto max-w-full object-contain"
          />
        </button>
      ) : null}

      <figcaption className="flex items-center gap-3 px-3.5 py-3">
        {(media.kind === "pdf" || media.kind === "file") && (
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-muted-foreground">
            {media.kind === "pdf" ? (
              <FileText className="h-5 w-5" />
            ) : (
              <FileArchive className="h-5 w-5" />
            )}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium text-foreground" title={media.name}>
            {media.name}
          </p>
          <p className="truncate text-[12.5px] text-meta">
            {saveFailed
              ? "The download did not finish. Try again."
              : media.caption
                ? `${media.caption} · ${size(media.size)}`
                : size(media.size)}
          </p>
        </div>
        {media.kind === "pdf" && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
        )}
        {broken !== "gone" && (
          <button
            onClick={() => void download()}
            disabled={saving !== null}
            aria-label={`Download ${media.name}`}
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground",
              saving !== null && "cursor-wait",
            )}
          >
            {saving !== null ? (
              <>
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {media.size > MEDIA_CHUNK ? `${Math.round(saving * 100)}%` : "Saving"}
              </>
            ) : (
              <>
                <Download className="h-3.5 w-3.5" /> Download
              </>
            )}
          </button>
        )}
      </figcaption>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={media.name}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
        >
          <button
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="absolute right-4 top-4 rounded-full bg-background/80 p-2 text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
          <img
            src={url}
            alt={media.caption || media.name}
            className="max-h-full max-w-full rounded-xl border border-border object-contain shadow-2xl"
          />
        </div>
      )}
    </figure>
  );
}
