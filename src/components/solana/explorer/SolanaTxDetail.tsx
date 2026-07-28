import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, CheckCircle2, XCircle, ExternalLink, ScanSearch } from "lucide-react";
import { getSolanaTxOverview } from "@/lib/api/solana-explorer.functions";
import { solanaExplorerLink, type SolanaCluster } from "@/lib/solana/chains";

function fmtUtc(t: number | null): string {
  if (!t) return "—";
  return new Date(t * 1000).toUTCString().replace("GMT", "UTC");
}

export function SolanaTxDetail({ cluster, signature }: { cluster: SolanaCluster; signature: string }) {
  const q = useQuery({
    queryKey: ["sol-tx-overview", cluster, signature],
    queryFn: () => getSolanaTxOverview({ data: { cluster, signature } }),
  });
  const d = q.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold text-foreground">Transaction</h1>
        <div className="flex items-center gap-3">
          <Link
            to="/routebook/solana/$signature"
            params={{ signature }}
            className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
          >
            <ScanSearch className="h-3.5 w-3.5" /> Inspect in Routebook
          </Link>
          <a
            href={solanaExplorerLink(cluster, "tx", signature)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
          >
            Solana Explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 font-mono text-sm text-meta">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading transaction…
        </div>
      )}
      {d && !d.ok && (
        <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">{d.error}</div>
      )}

      {d && d.ok && (
        <div className="rounded border border-border bg-surface">
          <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">Overview</div>
          <div className="divide-y divide-border">
            <Row label="Status">
              {d.success ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Success
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-danger">
                  <XCircle className="h-4 w-4" /> Failed
                </span>
              )}
            </Row>
            <Row label="Confirmation">{d.confirmation} (MAX Confirmations)</Row>
            <Row label="Signature">
              <span className="break-all text-foreground">{d.signature}</span>
            </Row>
            <Row label="Fee payer">
              <Link
                to="/explorer/$network/address/$hash"
                params={{ network: cluster, hash: d.feePayer }}
                className="break-all text-primary hover:underline"
              >
                {d.feePayer}
              </Link>
            </Row>
            <Row label="Slot">
              <Link
                to="/explorer/$network/block/$height"
                params={{ network: cluster, height: String(d.slot) }}
                className="text-primary hover:underline"
              >
                {d.slot.toLocaleString()}
              </Link>
            </Row>
            <Row label="Recent Blockhash">
              <span className="break-all text-foreground">{d.recentBlockhash}</span>
            </Row>
            <Row label="Fee">◎{d.feeSol.toFixed(9)}</Row>
            <Row label="Transaction cost">{d.feeLamports.toLocaleString()} lamports</Row>
            <Row label="CUs Consumed / Limit">
              {d.computeUnits !== null ? d.computeUnits.toLocaleString() : "—"} /{" "}
              {d.computeUnitsLimit !== null ? d.computeUnitsLimit.toLocaleString() : "—"}
            </Row>
            <Row label="Transaction Version">{d.version}</Row>
            <Row label="Accounts">{d.accountCount}</Row>
            <Row label="Timestamp">{fmtUtc(d.blockTime)}</Row>
            {d.err && (
              <Row label="Error">
                <span className="break-all text-danger">{d.err}</span>
              </Row>
            )}
          </div>
        </div>
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
