import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getStacksLatestTxns } from "@/lib/api/stacks-explorer.functions";
import type { StacksNetworkId } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";

const TYPE_COLOR: Record<string, string> = {
  contract_call: "#9945FF",
  smart_contract: "#5546FF",
  token_transfer: "#14b8a6",
  coinbase: "#f59e0b",
  tenure_change: "#64748b",
};

export function StacksTxns({ network }: { network: StacksNetworkId }) {
  const q = useQuery({
    queryKey: ["stx-txns-list", network],
    queryFn: () => getStacksLatestTxns({ data: { network, limit: 50 } }),
    refetchInterval: 12_000,
  });
  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Transactions</div>
      <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <span>Transaction</span>
        <span className="text-right">Type</span>
        <span className="text-right">Sender</span>
      </div>
      {!q.data && <div className="px-4 py-3 font-mono text-xs text-meta">Loading…</div>}
      {(q.data?.txns ?? []).map((t) => (
        <Link
          key={t.txid}
          to="/explorer/$network/tx/$hash"
          params={{ network, hash: t.txid }}
          className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
        >
          <span className="inline-flex min-w-0 items-center gap-2">
            <span className={t.status === "success" ? "text-success" : "text-danger"}>●</span>
            <span className="truncate text-primary">{truncateAddress(t.txid, 12, 8)}</span>
            {t.fnName && <span className="truncate text-muted-foreground">· {t.fnName}</span>}
          </span>
          <span className="text-right" style={{ color: TYPE_COLOR[t.type] ?? "#9ca3af" }}>
            {t.type}
          </span>
          <span className="text-right text-meta">{truncateAddress(t.sender, 4, 4)}</span>
        </Link>
      ))}
    </div>
  );
}
