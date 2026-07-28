import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ScanSearch,
  FileText,
  ArrowDownUp,
  Coins,
} from "lucide-react";
import { getSolanaTxOverview } from "@/lib/api/solana-explorer.functions";
import { decodeSolanaTransaction } from "@/lib/api/solana-decode.functions";
import { type SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

function fmtUtc(t: number | null): string {
  if (!t) return "—";
  return new Date(t * 1000).toUTCString().replace("GMT", "UTC");
}

export function SolanaTxDetail({
  cluster,
  signature,
}: {
  cluster: SolanaCluster;
  signature: string;
}) {
  const overview = useQuery({
    queryKey: ["sol-tx-overview", cluster, signature],
    queryFn: () => getSolanaTxOverview({ data: { cluster, signature } }),
  });
  // Instructions, balance changes, and program logs — the same decode already
  // powering Routebook's Solana view — rendered here too so the explorer's tx
  // page has EVM-explorer-level detail instead of a single flat overview table.
  const decoded = useQuery({
    queryKey: ["sol-tx-decode", cluster, signature],
    queryFn: () => decodeSolanaTransaction({ data: { cluster, signature } }),
  });
  const d = overview.data;
  const dec = decoded.data;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold text-foreground">Transaction</h1>
        <Link
          to="/routebook/solana/$signature"
          params={{ signature }}
          className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
        >
          <ScanSearch className="h-3.5 w-3.5" /> Inspect in Routebook
        </Link>
      </div>

      {overview.isLoading && (
        <div className="flex items-center gap-2 font-mono text-sm text-meta">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading transaction…
        </div>
      )}
      {d && !d.ok && (
        <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">
          {d.error}
        </div>
      )}

      {d && d.ok && (
        <div className="rounded border border-border bg-surface">
          <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
            Overview
          </div>
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

      {dec && dec.ok && (
        <>
          <Section icon={FileText} title={`Instructions (${dec.instructions.length})`}>
            {dec.instructions.map((ix) => (
              <div
                key={ix.index}
                className="border-b border-border px-4 py-2 font-mono text-xs last:border-0"
              >
                <div className="flex items-center gap-2">
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">
                    #{ix.index}
                  </span>
                  <span className="font-bold text-foreground">{ix.program}</span>
                  <span className="text-meta">· {ix.type}</span>
                </div>
                {ix.summary && (
                  <div className="mt-1 break-all text-muted-foreground">{ix.summary}</div>
                )}
              </div>
            ))}
          </Section>

          {(dec.solChanges.length > 0 || dec.tokenChanges.length > 0) && (
            <Section icon={ArrowDownUp} title="Balance changes">
              {dec.solChanges.map((c) => (
                <ChangeRow
                  key={`sol-${c.account}`}
                  cluster={cluster}
                  account={c.account}
                  delta={c.delta}
                  unit="SOL"
                />
              ))}
              {dec.tokenChanges.map((c, i) => (
                <ChangeRow
                  key={`tok-${c.account}-${i}`}
                  cluster={cluster}
                  account={c.account}
                  delta={c.delta}
                  unit="tokens"
                  mint={c.mint}
                />
              ))}
            </Section>
          )}

          <Section icon={ScanSearch} title={`Accounts (${dec.accounts.length})`}>
            {dec.accounts.map((a) => (
              <div
                key={a.pubkey}
                className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs last:border-0"
              >
                <Link
                  to="/explorer/$network/address/$hash"
                  params={{ network: cluster, hash: a.pubkey }}
                  className="truncate text-primary hover:underline"
                  title={a.pubkey}
                >
                  {truncateAddress(a.pubkey, 8, 8)}
                </Link>
                <span className="ml-auto flex gap-1.5 text-[10px] text-meta">
                  {a.signer && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">Signer</span>
                  )}
                  {a.writable && (
                    <span className="rounded bg-warning/10 px-1.5 py-0.5 text-warning">
                      Writable
                    </span>
                  )}
                </span>
              </div>
            ))}
          </Section>

          {dec.logs.length > 0 && (
            <Section icon={Coins} title="Program logs">
              <pre className="max-h-72 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                {dec.logs.join("\n")}
              </pre>
            </Section>
          )}
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

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileText;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" /> {title}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ChangeRow({
  cluster,
  account,
  delta,
  unit,
  mint,
}: {
  cluster: SolanaCluster;
  account: string;
  delta: number;
  unit: string;
  mint?: string;
}) {
  const positive = delta > 0;
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs last:border-0">
      <Link
        to="/explorer/$network/address/$hash"
        params={{ network: cluster, hash: account }}
        className="truncate text-primary hover:underline"
        title={account}
      >
        {truncateAddress(account, 8, 8)}
      </Link>
      {mint && <span className="text-meta">({truncateAddress(mint, 4, 4)})</span>}
      <span className={`ml-auto ${positive ? "text-success" : "text-danger"}`}>
        {positive ? "+" : ""}
        {delta} {unit}
      </span>
    </div>
  );
}
