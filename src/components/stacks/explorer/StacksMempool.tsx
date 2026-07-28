import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { getStacksMempool } from "@/lib/api/stacks-explorer.functions";
import type { StacksNetworkId } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";

export function StacksMempool({ network }: { network: StacksNetworkId }) {
  const q = useQuery({ queryKey: ["stx-mempool", network], queryFn: () => getStacksMempool({ data: { network } }), refetchInterval: 8_000 });
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Clock className="h-3.5 w-3.5 text-warning" /> Mempool — pending transactions
      </div>
      {!q.data && <div className="px-4 py-3 font-mono text-xs text-meta">Loading…</div>}
      {q.data?.txns.length === 0 && <div className="px-4 py-3 font-mono text-xs text-meta">Mempool is empty.</div>}
      {(q.data?.txns ?? []).map((t) => (
        <Link
          key={t.txid}
          to="/explorer/$network/tx/$hash"
          params={{ network, hash: t.txid }}
          className="flex items-center gap-2 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
        >
          <span className="text-warning">●</span>
          <span className="truncate text-primary">{truncateAddress(t.txid, 12, 8)}</span>
          <span className="text-meta">· {t.type}</span>
          {t.fnName && <span className="text-muted-foreground">· {t.fnName}</span>}
          <span className="ml-auto shrink-0 text-meta">{truncateAddress(t.sender, 4, 4)}</span>
        </Link>
      ))}
    </div>
  );
}
