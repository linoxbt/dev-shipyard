import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";
import { getSolanaAddress } from "@/lib/api/solana-explorer.functions";
import { solanaExplorerLink, type SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

const KNOWN_OWNERS: Record<string, string> = {
  "11111111111111111111111111111111": "System Program",
  TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA: "Token Program",
  TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb: "Token-2022 Program",
  BPFLoaderUpgradeab1e11111111111111111111111: "BPF Upgradeable Loader",
};

function fmtUtc(t: number | null): string {
  if (!t) return "—";
  return new Date(t * 1000).toUTCString().replace("GMT", "UTC");
}

export function SolanaAddressDetail({ cluster, address }: { cluster: SolanaCluster; address: string }) {
  const q = useQuery({
    queryKey: ["sol-addr-detail", cluster, address],
    queryFn: () => getSolanaAddress({ data: { cluster, address } }),
  });
  const d = q.data;
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold text-foreground">Account</h1>
        <a
          href={solanaExplorerLink(cluster, "address", address)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
        >
          Solana Explorer <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 font-mono text-sm text-meta">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading account…
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
              <Row label="Address">
                <span className="inline-flex items-center gap-2 break-all text-foreground">
                  {address}
                  <button
                    onClick={async () => {
                      await navigator.clipboard.writeText(address);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                    className="text-meta hover:text-foreground"
                  >
                    {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                  </button>
                </span>
              </Row>
              <Row label="Balance (SOL)">◎{d.sol.toFixed(9)}</Row>
              <Row label="Allocated Data Size">{d.dataSize.toLocaleString()} byte(s)</Row>
              <Row label="Assigned Program Id">
                {d.owner ? (
                  <Link
                    to="/explorer/$network/address/$hash"
                    params={{ network: cluster, hash: d.owner }}
                    className="break-all text-primary hover:underline"
                  >
                    {KNOWN_OWNERS[d.owner] ?? d.owner}
                  </Link>
                ) : (
                  "—"
                )}
              </Row>
              <Row label="Executable">{d.executable ? "Yes" : "No"}</Row>
            </div>
          </div>

          <div className="rounded border border-border bg-surface">
            <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
              Transaction History
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
              <span>Signature</span>
              <span className="text-right">Slot</span>
              <span className="text-right">Result</span>
            </div>
            {d.signatures.length === 0 && <div className="px-4 py-3 font-mono text-xs text-meta">No transactions</div>}
            {d.signatures.map((s) => (
              <Link
                key={s.signature}
                to="/explorer/$network/tx/$hash"
                params={{ network: cluster, hash: s.signature }}
                className="grid grid-cols-[1fr_auto_auto] items-center gap-x-3 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
              >
                <span className="truncate text-primary" title={s.signature}>
                  {truncateAddress(s.signature, 12, 12)}
                </span>
                <span className="text-right text-muted-foreground">{s.slot.toLocaleString()}</span>
                <span className={`text-right ${s.err ? "text-danger" : "text-success"}`}>
                  {s.err ? "Failed" : "Success"}
                </span>
              </Link>
            ))}
            <div className="border-t border-border px-4 py-2 font-mono text-[10px] text-meta">
              Showing latest {d.signatures.length} · {fmtUtc(d.signatures[0]?.blockTime ?? null)}
            </div>
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
