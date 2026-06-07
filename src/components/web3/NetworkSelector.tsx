import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { cn } from "@/lib/utils";

// Network selector. Lets the user choose QIE Testnet or Mainnet — both are
// fully supported. The selection drives the whole app's reads; switching also
// asks the connected wallet to follow. A ⚠ shows when the wallet is on a
// different chain than the selection.
export function NetworkSelector({ className }: { className?: string }) {
  const { chainId, supported, select, isTestnet, walletMismatch } = useActiveChain();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded border border-border bg-surface shadow-lg">
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
