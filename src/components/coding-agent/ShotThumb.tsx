import { useState } from "react";
import { X } from "lucide-react";
import { useShot } from "@/lib/coding-agent/shots";

// A screenshot the agent took, shown in the chat the way a person would paste
// one: a thumbnail that opens larger (lib/coding-agent/shots.ts finds it).

export function ShotThumb({ shot, label }: { shot: string; label: string }) {
  const src = useShot(shot);
  const [open, setOpen] = useState(false);
  if (!src) {
    return <div className="h-36 w-48 animate-pulse rounded-xl border border-border bg-surface-2" />;
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={`${label}: open larger`}
        className="overflow-hidden rounded-xl border border-border bg-surface-2 transition hover:border-primary/50"
      >
        <img src={src} alt={label} className="h-36 w-auto max-w-[260px] object-cover object-top" />
      </button>
      {open && (
        <div
          role="dialog"
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
