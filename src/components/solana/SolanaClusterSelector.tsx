// Solana cluster selector (devnet / mainnet-beta). The Solana analog of the EVM
// NetworkSelector, but drives the separate Solana preference store so it never
// touches EVM active-chain state.

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { SOLANA_CHAINS } from "@/lib/solana/chains";
import { ChainLogo } from "@/lib/chain-logos";
import { cn } from "@/lib/utils";

export function SolanaClusterSelector({ className }: { className?: string }) {
  const cluster = useSolanaPref((s) => s.cluster);
  const setCluster = useSolanaPref((s) => s.setCluster);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const active = SOLANA_CHAINS.find((c) => c.id === cluster);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground transition hover:border-primary/50"
      >
        <ChainLogo family="Solana" size={14} />
        <span className="truncate">{active?.name ?? "Select cluster"}</span>
        <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", active?.testnet ? "bg-warning" : "bg-info")} />
        <ChevronDown className="h-3 w-3 text-meta" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded border border-border bg-surface shadow-lg">
          {SOLANA_CHAINS.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCluster(c.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", c.testnet ? "bg-warning" : "bg-info")} />
              <span>{c.name}</span>
              {c.id === cluster && <Check className="ml-auto h-3 w-3 text-success" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
