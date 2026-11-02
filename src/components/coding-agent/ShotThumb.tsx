import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useShot } from "@/lib/coding-agent/shots";

// A screenshot the agent took, shown in the chat the way a person would paste
// one: a thumbnail that opens larger (lib/coding-agent/shots.ts finds it).

export function ShotThumb({
  shot,
  label,
  small,
}: {
  shot: string;
  label: string;
  small?: boolean;
}) {
  const { src, failed, retry } = useShot(shot);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  if (!src) {
    return failed ? (
      <button
        onClick={retry}
        className="flex h-36 w-48 items-center justify-center rounded-xl border border-dashed border-border text-[11.5px] text-meta hover:text-foreground"
      >
        Screenshot unavailable. Retry
      </button>
    ) : (
      <div className="h-36 w-48 animate-pulse rounded-xl border border-border bg-surface-2" />
    );
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`${label}: open larger`}
        className={`overflow-hidden border border-border bg-surface-2 transition hover:border-primary/50 ${small ? "rounded-2xl" : "rounded-xl"}`}
      >
        <img
          src={src}
          alt={label}
          className={
            small ? "h-20 w-20 object-cover" : "h-36 w-auto max-w-[260px] object-cover object-top"
          }
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={label}
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
            src={src}
            alt={label}
            className="max-h-full max-w-full rounded-xl border border-border object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
