import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { ChevronDown, Check, AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useActiveFamily } from "@/lib/active-network";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { useStacksPref } from "@/lib/stacks/active-stacks";
import { SOLANA_CHAINS } from "@/lib/solana/chains";
import { STACKS_CHAINS } from "@/lib/stacks/chains";
import { ChainLogo } from "@/lib/chain-logos";
import { cn } from "@/lib/utils";

// Unified network selector across EVM chains, Solana clusters, and Stacks
// networks. Selecting one flips the active chain family so the shared feature
// pages (Templates, Editor, Code with AI, Deploy, Analytics) switch variants.
export function NetworkSelector({ className }: { className?: string }) {
  const { chainId, supported, select, isTestnet, walletMismatch } = useActiveChain();
  const family = useActiveFamily((s) => s.family);
  const setFamily = useActiveFamily((s) => s.setFamily);
  const solCluster = useSolanaPref((s) => s.cluster);
  const setCluster = useSolanaPref((s) => s.setCluster);
  const stxNet = useStacksPref((s) => s.network);
  const setStxNet = useStacksPref((s) => s.setNetwork);

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

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    setOpenUpward(spaceBelow < 320 && spaceAbove > spaceBelow);
  }, [open]);

  const activeEvm = supported.find((c) => c.id === chainId);
  const activeSol = SOLANA_CHAINS.find((c) => c.id === solCluster);
  const activeStx = STACKS_CHAINS.find((c) => c.id === stxNet);

  let activeLabel = activeEvm?.name ?? "Select network";
  let activeLogoFamily = activeEvm?.name ?? "";
  let activeIsTestnet = isTestnet;
  if (family === "solana") {
    activeLabel = activeSol?.name ?? "Solana";
    activeLogoFamily = "Solana";
    activeIsTestnet = activeSol?.testnet ?? true;
  } else if (family === "stacks") {
    activeLabel = activeStx?.name ?? "Stacks";
    activeLogoFamily = "Stacks";
    activeIsTestnet = activeStx?.testnet ?? true;
  }

  const close = () => setOpen(false);

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground transition hover:border-primary/50"
      >
        <ChainLogo family={activeLogoFamily} size={14} />
        <span className="truncate">{activeLabel}</span>
        {family === "evm" && walletMismatch && (
          <AlertTriangle className="h-3 w-3 text-warning" aria-label="Wallet on a different network" />
        )}
        <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", activeIsTestnet ? "bg-warning" : "bg-info")} />
        <ChevronDown className="h-3 w-3 text-meta" />
      </button>

      {open && (
        <div
          className={cn(
            "absolute z-50 max-h-80 w-full overflow-y-auto rounded border border-border bg-surface shadow-lg",
            openUpward ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          <Group label="EVM" />
          {supported.map((c) => (
            <Item
              key={c.id}
              logoFamily={c.name}
              name={c.name}
              testnet={c.testnet}
              active={family === "evm" && c.id === chainId}
              onClick={() => {
                select(c.id);
                setFamily("evm");
                close();
              }}
            />
          ))}
          <Group label="Solana" />
          {SOLANA_CHAINS.map((c) => (
            <Item
              key={c.id}
              logoFamily="Solana"
              name={c.name}
              testnet={c.testnet}
              active={family === "solana" && c.id === solCluster}
              onClick={() => {
                setCluster(c.id);
                setFamily("solana");
                close();
              }}
            />
          ))}
          <Group label="Stacks" />
          {STACKS_CHAINS.map((c) => (
            <Item
              key={c.id}
              logoFamily="Stacks"
              name={c.name}
              testnet={c.testnet}
              active={family === "stacks" && c.id === stxNet}
              onClick={() => {
                setStxNet(c.id);
                setFamily("stacks");
                close();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Group({ label }: { label: string }) {
  return <div className="px-2.5 pb-1 pt-2 font-mono text-[9px] uppercase tracking-wider text-meta">{label}</div>;
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
      <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", testnet ? "bg-warning" : "bg-info")} />
      {active && <Check className="h-3 w-3 text-success" />}
    </button>
  );
}
