import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getStacksBlocks } from "@/lib/api/stacks-explorer.functions";
import type { StacksNetworkId } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";

function age(t: number | null): string {
  if (!t) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function StacksBlocks({ network }: { network: StacksNetworkId }) {
  const q = useQuery({ queryKey: ["stx-blocks-list", network], queryFn: () => getStacksBlocks({ data: { network } }), refetchInterval: 12_000 });
  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Blocks</div>
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <span>Height</span>
        <span>Hash</span>
        <span className="text-right">Txns</span>
        <span className="text-right">Age</span>
      </div>
      {!q.data && <div className="px-4 py-3 font-mono text-xs text-meta">Loading…</div>}
      {(q.data?.blocks ?? []).map((b) => (
        <Link
          key={b.hash}
          to="/explorer/$network/block/$height"
          params={{ network, height: String(b.height) }}
          className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
        >
          <span className="text-primary">#{b.height.toLocaleString()}</span>
          <span className="truncate text-meta">{truncateAddress(b.hash, 8, 6)}</span>
          <span className="text-right text-muted-foreground">{b.txCount}</span>
          <span className="text-right text-meta">{age(b.time)}</span>
        </Link>
      ))}
    </div>
  );
}
