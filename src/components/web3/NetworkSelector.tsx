import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { ChevronDown, Check, AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { cn } from "@/lib/utils";

// Network selector. Lets the user pick any supported chain + network — the
// list has grown to ~12 entries across 7 chain families, so it no longer
// fits without scrolling. The selection drives the whole app's reads;
// switching also asks the connected wallet to follow. A ⚠ shows when the
// wallet is on a different chain than the selection.
export function NetworkSelector({ className }: { className?: string }) {
  const { chainId, supported, select, isTestnet, walletMismatch } = useActiveChain();
  const [open, setOpen] = useState(false);
  // Flip the panel to open upward when there isn't enough room below the
  // trigger — this selector lives at the bottom of the sidebar, where a
  // downward-opening, taller-than-before panel used to render off the
  // bottom of the viewport with no way to see or scroll to it.
  const [openUpward, setOpenUpward] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Measure available space right before paint whenever the panel opens, so
  // there's no visible flicker between "opened downward" and "flipped up."
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const PANEL_MAX_HEIGHT = 256; // keep in sync with max-h-64 below
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow);
  }, [open]);

  const dotColor = isTestnet ? "bg-warning" : "bg-info";
  const active = supported.find((c) => c.id === chainId);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground transition hover:border-primary/50"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", dotColor)} />
        <span className="truncate">{active?.name ?? "Select network"}</span>
        {walletMismatch && (
          <AlertTriangle
            className="h-3 w-3 text-warning"
            aria-label="Your wallet is on a different network"
          />
        )}
        <ChevronDown className="ml-auto h-3 w-3 text-meta" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 max-h-64 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {supported.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                select(c.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            >
              <span
                className={cn("h-1.5 w-1.5 rounded-full", c.testnet ? "bg-warning" : "bg-info")}
              />
              <span>{c.name}</span>
              <span className="text-meta">· {c.id}</span>
              {c.id === chainId && <Check className="ml-auto h-3 w-3 text-success" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
