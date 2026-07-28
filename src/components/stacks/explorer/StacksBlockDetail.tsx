import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ExternalLink } from "lucide-react";
import { getStacksBlock } from "@/lib/api/stacks-explorer.functions";
import { stacksExplorerLink, type StacksNetworkId } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";

export function StacksBlockDetail({ network, id }: { network: StacksNetworkId; id: string }) {
  const q = useQuery({ queryKey: ["stx-block", network, id], queryFn: () => getStacksBlock({ data: { network, id } }) });
  const d = q.data;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-mono text-lg font-bold text-foreground">Block #{id}</h1>
        {d?.ok && (
          <a href={`${stacksExplorerLink(network, "txid", d.hash).replace("/txid/", "/block/")}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary">
            Hiro Explorer <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
      {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-meta" />}
      {d && !d.ok && <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">{d.error}</div>}
      {d && d.ok && (
        <>
          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Overview</div>
            <div className="divide-y divide-border">
              <Row label="Height" value={`#${d.height.toLocaleString()}`} />
              <Row label="Hash" value={d.hash} />
              <Row label="Parent hash" value={d.parentHash} />
              <Row label="Bitcoin block" value={String(d.burnBlockHeight)} />
              <Row label="Time" value={d.time ? new Date(d.time * 1000).toUTCString() : "—"} />
              <Row label="Transactions" value={String(d.txCount)} />
            </div>
          </div>
          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Transactions in block</div>
            {d.txns.map((t) => (
              <Link
                key={t.txid}
                to="/explorer/$network/tx/$hash"
                params={{ network, hash: t.txid }}
                className="flex items-center gap-2 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
              >
                <span className={t.status === "success" ? "text-success" : "text-danger"}>●</span>
                <span className="truncate text-primary">{truncateAddress(t.txid, 10, 8)}</span>
                <span className="text-meta">· {t.type}</span>
                {t.fnName && <span className="text-muted-foreground">· {t.fnName}</span>}
              </Link>
            ))}
            {d.txns.length === 0 && <div className="px-4 py-3 font-mono text-xs text-meta">No transactions</div>}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 font-mono text-xs sm:flex-row sm:items-center sm:gap-4">
      <span className="w-40 shrink-0 text-meta">{label}</span>
      <span className="min-w-0 break-all text-foreground">{value}</span>
    </div>
  );
}
