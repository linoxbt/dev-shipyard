import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Blocks, Fuel, KeyRound } from "lucide-react";
import { getNetworkStatus } from "@/lib/api/chain.functions";
import { chainConfig } from "@/lib/chains";

// Minimal native page for chains whose real explorer requires an API key we
// don't have (X Layer/OKLink). Shows live RPC-sourced block height + gas
// price — no Blockscout/Routescan-shaped browsing (tx/block/address pages)
// since there's no data source for that yet. Upgrade path: once an OKLink
// API key is available, replace this with a real adapter the same way
// Avalanche's Routescan adapter was built.
export function LimitedExplorer({
  chainId,
  familyLabel,
  isMainnet,
}: {
  chainId: number;
  familyLabel: string;
  isMainnet: boolean;
}) {
  const cfg = chainConfig(chainId);
  const { data, isLoading } = useQuery({
    queryKey: ["network-status", chainId],
    queryFn: () => getNetworkStatus({ data: { chainId } }),
    refetchInterval: 6_000,
  });

  return (
    <div className="mx-auto max-w-2xl py-10">
      <div className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-2 text-warning">
          <KeyRound className="h-4 w-4" />
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider">
            Limited explorer
          </span>
        </div>
        <h1 className="mt-2 font-mono text-lg font-bold text-foreground">
          {familyLabel} {isMainnet ? "Mainnet" : "Testnet"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {familyLabel}'s official explorer (OKLink) requires a registered API key that DevStation
          doesn't have yet, so block/transaction/address browsing isn't available here. Wallet
          connect, deploys, and the AI agent all work normally on this chain — only this internal
          dashboard is limited. Live network status below is read directly from the chain's RPC.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-1.5 text-meta">
              <Blocks className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] uppercase tracking-wider">Block height</span>
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-foreground">
              {isLoading
                ? "…"
                : data?.status === "online"
                  ? data.blockNumber.toLocaleString()
                  : "—"}
            </div>
          </div>
          <div className="rounded border border-border bg-surface-2 p-4">
            <div className="flex items-center gap-1.5 text-meta">
              <Fuel className="h-3.5 w-3.5" />
              <span className="font-mono text-[10px] uppercase tracking-wider">Gas price</span>
            </div>
            <div className="mt-1 font-mono text-xl font-bold text-foreground">
              {isLoading
                ? "…"
                : data?.status === "online"
                  ? `${data.gasPriceGwei.toFixed(2)} gwei`
                  : "—"}
            </div>
          </div>
        </div>

        <a
          href={cfg.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-6 inline-flex items-center gap-1.5 rounded border border-primary/50 bg-primary/10 px-3 py-2 font-mono text-xs font-bold text-primary transition hover:bg-primary/20"
        >
          Open full explorer on OKLink <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
