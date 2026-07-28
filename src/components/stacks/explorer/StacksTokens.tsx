import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Coins, Info } from "lucide-react";
import { getStacksTokens } from "@/lib/api/stacks-explorer.functions";
import type { StacksNetworkId } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";

export function StacksTokens({ network }: { network: StacksNetworkId }) {
  const q = useQuery({ queryKey: ["stx-tokens", network], queryFn: () => getStacksTokens({ data: { network } }) });
  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
          <Coins className="h-3.5 w-3.5 text-primary" /> Fungible Tokens
        </div>
        <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
          <span>Symbol</span>
          <span>Name</span>
          <span className="text-right">Decimals</span>
          <span className="text-right">Contract</span>
        </div>
        {!q.data && <div className="px-4 py-3 font-mono text-xs text-meta">Loading…</div>}
        {q.data?.tokens.length === 0 && <div className="px-4 py-3 font-mono text-xs text-meta">No tokens returned.</div>}
        {(q.data?.tokens ?? []).map((t, i) => (
          <Link
            key={t.contract || i}
            to="/explorer/$network/address/$hash"
            params={{ network, hash: t.contract }}
            className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
          >
            <span className="font-bold text-foreground">{t.symbol || "—"}</span>
            <span className="truncate text-muted-foreground">{t.name}</span>
            <span className="text-right text-meta">{t.decimals}</span>
            <span className="text-right text-primary">{t.contract ? truncateAddress(t.contract, 4, 4) : "—"}</span>
          </Link>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded border border-border bg-surface-2 p-3 font-mono text-[10px] text-meta">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>Sourced from the Hiro token metadata API. Click a token to open its contract page.</span>
      </div>
    </div>
  );
}
