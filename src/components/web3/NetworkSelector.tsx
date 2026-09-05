import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { ChevronDown, Check, AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { ChainLogo } from "@/lib/chain-logos";
import { cn } from "@/lib/utils";

// Network selector across DevStation's supported chains (QIE and BOT Chain,
// testnet + mainnet each). The selected network, not the wallet's current
// chain: drives reads everywhere in the app.
export function NetworkSelector({ className }: { className?: string }) {
  const { chainId, supported, select, isTestnet, walletMismatch } = useActiveChain();

  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Open upward when there isn't room below: the sidebar sits low enough that
  // a downward panel would otherwise render off-screen.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < 320 && spaceAbove > spaceBelow);
  }, [open]);

  const active = supported.find((c) => c.id === chainId);
  const close = () => setOpen(false);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground transition hover:border-primary/50"
      >
        <ChainLogo family={active?.name ?? ""} size={14} />
        <span className="truncate">{active?.name ?? "Select network"}</span>
        {walletMismatch && (
          <AlertTriangle
            className="h-3 w-3 text-warning"
            aria-label="Wallet on a different network"
          />
        )}
        <span
          className={cn("ml-auto h-1.5 w-1.5 rounded-full", isTestnet ? "bg-warning" : "bg-info")}
        />
        <ChevronDown className="h-3 w-3 text-meta" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 max-h-80 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {supported.map((c) => (
            <Item
              key={c.id}
              logoFamily={c.name}
              name={c.name}
              testnet={!!c.testnet}
              active={c.id === chainId}
              onClick={() => {
                select(c.id);
                close();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Item({
  logoFamily,
  name,
  testnet,
  active,
  onClick,
}: {
  logoFamily: string;
  name: string;
  testnet: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2.5 py-2 text-left font-mono text-xs text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
    >
      <ChainLogo family={logoFamily} size={13} />
      <span className="truncate">{name}</span>
      <span
        className={cn("ml-auto h-1.5 w-1.5 rounded-full", testnet ? "bg-warning" : "bg-info")}
      />
      {active && <Check className="h-3 w-3 text-success" />}
    </button>
  );
}
