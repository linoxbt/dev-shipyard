import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ExternalLink } from "lucide-react";
import { getSolanaBlock } from "@/lib/api/solana-explorer.functions";
import { solanaExplorerLink, type SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

function fmtUtc(t: number | null): string {
  if (!t) return "—";
  return new Date(t * 1000).toUTCString().replace("GMT", "UTC");
}

export function SolanaBlockDetail({ cluster, slot }: { cluster: SolanaCluster; slot: number }) {
  const q = useQuery({
    queryKey: ["sol-block", cluster, slot],
    queryFn: () => getSolanaBlock({ data: { cluster, slot } }),
  });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold text-foreground">Block {slot.toLocaleString()}</h1>
        <a
          href={solanaExplorerLink(cluster, "block", String(slot))}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
        >
          Solana Explorer <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 font-mono text-sm text-meta">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading block…
        </div>
      )}
      {d && !d.ok && (
        <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">{d.error}</div>
      )}

      {d && d.ok && (
        <>
          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Overview</div>
            <div className="divide-y divide-border">
              <Row label="Slot">{d.slot.toLocaleString()}</Row>
              <Row label="Parent Slot">
                <Link
                  to="/explorer/$network/block/$height"
                  params={{ network: cluster, height: String(d.parentSlot) }}
                  className="text-primary hover:underline"
                >
                  {d.parentSlot.toLocaleString()}
                </Link>
              </Row>
              <Row label="Blockhash">
                <span className="break-all text-foreground">{d.blockhash}</span>
              </Row>
              <Row label="Previous Blockhash">
                <span className="break-all text-foreground">{d.previousBlockhash}</span>
              </Row>
              <Row label="Timestamp">{fmtUtc(d.blockTime)}</Row>
              <Row label="Transactions">{d.txCount.toLocaleString()}</Row>
            </div>
          </div>

          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
              Block Transactions
            </div>
            {d.signatures.length === 0 && <div className="px-4 py-3 font-mono text-xs text-meta">No transactions</div>}
            {d.signatures.map((sig) => (
              <Link
                key={sig}
                to="/explorer/$network/tx/$hash"
                params={{ network: cluster, hash: sig }}
                className="flex items-center gap-2 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
              >
                <span className="truncate text-primary" title={sig}>
                  {truncateAddress(sig, 12, 12)}
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 font-mono text-xs sm:flex-row sm:items-center sm:gap-4">
      <span className="w-48 shrink-0 text-meta">{label}</span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}
