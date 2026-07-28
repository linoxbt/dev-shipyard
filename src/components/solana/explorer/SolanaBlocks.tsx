import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getSolanaBlocksList } from "@/lib/api/solana-explorer.functions";
import type { SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

function age(t: number | null): string {
  if (!t) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function SolanaBlocks({ cluster }: { cluster: SolanaCluster }) {
  const q = useQuery({
    queryKey: ["sol-blocks-list", cluster],
    queryFn: () => getSolanaBlocksList({ data: { cluster } }),
    refetchInterval: 10_000,
  });

  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Blocks</div>
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <span>Slot</span>
        <span className="text-right">Txns</span>
        <span className="hidden text-right sm:block">Blockhash</span>
        <span className="text-right">Age</span>
      </div>
      {!q.data && <div className="px-4 py-3 font-mono text-xs text-meta">Loading blocks…</div>}
      {q.data?.blocks.map((b) => (
        <Link
          key={b.slot}
          to="/explorer/$network/block/$height"
          params={{ network: cluster, height: String(b.slot) }}
          className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
        >
          <span className="truncate text-primary">{b.slot.toLocaleString()}</span>
          <span className="text-right text-muted-foreground">{b.txCount}</span>
          <span className="hidden text-right text-meta sm:block">{b.blockhash ? truncateAddress(b.blockhash, 4, 4) : "—"}</span>
          <span className="text-right text-meta">{age(b.blockTime)}</span>
        </Link>
      ))}
    </div>
  );
}
