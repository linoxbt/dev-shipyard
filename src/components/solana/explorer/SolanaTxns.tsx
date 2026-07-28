import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { getSolanaTxnsList } from "@/lib/api/solana-explorer.functions";
import type { SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

export function SolanaTxns({ cluster }: { cluster: SolanaCluster }) {
  const q = useQuery({
    queryKey: ["sol-txns-list", cluster],
    queryFn: () => getSolanaTxnsList({ data: { cluster } }),
    refetchInterval: 10_000,
  });

  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Transactions</div>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <span>Signature</span>
        <span className="text-right">Slot</span>
      </div>
      {!q.data && <div className="px-4 py-3 font-mono text-xs text-meta">Loading transactions…</div>}
      {q.data?.transactions.map((t) => (
        <Link
          key={t.signature}
          to="/explorer/$network/tx/$hash"
          params={{ network: cluster, hash: t.signature }}
          className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <FileText className="h-3 w-3 shrink-0 text-meta" />
            <span className="truncate text-primary">{truncateAddress(t.signature, 14, 14)}</span>
          </span>
          <span className="text-right text-meta">{t.slot.toLocaleString()}</span>
        </Link>
      ))}
    </div>
  );
}
