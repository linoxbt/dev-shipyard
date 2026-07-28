import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ExternalLink, CheckCircle2, XCircle, ArrowDownUp, Coins, FileText } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ChainLogo } from "@/lib/chain-logos";
import { decodeSolanaTransaction } from "@/lib/api/solana-decode.functions";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { solanaExplorerLink, type SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

export const Route = createFileRoute("/routebook/solana/$signature")({
  head: () => ({ meta: [{ title: "Solana Transaction — Routebook" }] }),
  component: SolanaTx,
});

// Try the user's active cluster first, then the other — a signature carries no
// cluster, so we resolve which one it lives on (mirrors the EVM routebook
// trying every supported chain).
async function resolveTx(signature: string, preferred: SolanaCluster) {
  const order: SolanaCluster[] =
    preferred === "solana-devnet"
      ? ["solana-devnet", "solana-mainnet"]
      : ["solana-mainnet", "solana-devnet"];
  for (const cluster of order) {
    const res = await decodeSolanaTransaction({ data: { cluster, signature } });
    if (res.ok) return res;
  }
  return { ok: false as const, error: "Transaction not found on devnet or mainnet-beta." };
}

function SolanaTx() {
  const { signature } = Route.useParams();
  const preferred = useSolanaPref((s) => s.cluster);

  const q = useQuery({
    queryKey: ["sol-tx", signature, preferred],
    queryFn: () => resolveTx(signature, preferred),
  });

  const data = q.data;

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Routebook", "Solana"]}
        title="Transaction Inspector"
        subtitle={truncateAddress(signature, 12, 12)}
        action={<ChainLogo family="Solana" size={22} />}
      />

      <div className="space-y-6 p-4 lg:p-6">
        {q.isLoading && (
          <div className="flex items-center gap-2 font-mono text-sm text-meta">
            <Loader2 className="h-4 w-4 animate-spin" /> Decoding transaction…
          </div>
        )}

        {data && !data.ok && (
          <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">
            {data.error}
          </div>
        )}

        {data && data.ok && (
          <>
            {/* Summary */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat
                label="Status"
                value={
                  data.success ? (
                    <span className="inline-flex items-center gap-1 text-success">
                      <CheckCircle2 className="h-4 w-4" /> Success
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <XCircle className="h-4 w-4" /> Failed
                    </span>
                  )
                }
              />
              <Stat label="Slot" value={data.slot.toLocaleString()} />
              <Stat label="Fee" value={`${data.feeSol.toFixed(6)} SOL`} />
              <Stat label="Compute" value={data.computeUnits ? data.computeUnits.toLocaleString() : "—"} />
            </div>

            <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-meta">
              <span>Cluster: {data.cluster === "solana-mainnet" ? "Mainnet Beta" : "Devnet"}</span>
              <span>Accounts: {data.accountCount}</span>
              {data.blockTime && <span>{new Date(data.blockTime * 1000).toLocaleString()}</span>}
              <a
                href={solanaExplorerLink(data.cluster, "tx", data.signature)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                Open on Solana Explorer <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {data.err && (
              <div className="rounded border border-danger/40 bg-danger/10 p-3 font-mono text-xs text-danger">
                Error: {data.err}
              </div>
            )}

            {/* Instructions */}
            <Section icon={FileText} title={`Instructions (${data.instructions.length})`}>
              {data.instructions.map((ix) => (
                <div key={ix.index} className="border-b border-border px-4 py-2 font-mono text-xs last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">#{ix.index}</span>
                    <span className="font-bold text-foreground">{ix.program}</span>
                    <span className="text-meta">· {ix.type}</span>
                  </div>
                  {ix.summary && <div className="mt-1 break-all text-muted-foreground">{ix.summary}</div>}
                </div>
              ))}
            </Section>

            {/* Balance changes */}
            {(data.solChanges.length > 0 || data.tokenChanges.length > 0) && (
              <Section icon={ArrowDownUp} title="Balance changes">
                {data.solChanges.map((c) => (
                  <ChangeRow key={`sol-${c.account}`} account={c.account} delta={c.delta} unit="SOL" />
                ))}
                {data.tokenChanges.map((c, i) => (
                  <ChangeRow
                    key={`tok-${c.account}-${i}`}
                    account={c.account}
                    delta={c.delta}
                    unit="tokens"
                    mint={c.mint}
                  />
                ))}
              </Section>
            )}

            {/* Logs */}
            {data.logs.length > 0 && (
              <Section icon={Coins} title="Program logs">
                <pre className="max-h-72 overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {data.logs.join("\n")}
                </pre>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="font-mono text-sm font-bold text-foreground">{value}</div>
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
  account,
  delta,
  unit,
  mint,
}: {
  account: string;
  delta: number;
  unit: string;
  mint?: string;
}) {
  const positive = delta > 0;
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs last:border-0">
      <span className="truncate text-muted-foreground" title={account}>
        {truncateAddress(account, 8, 8)}
      </span>
      {mint && <span className="text-meta">({truncateAddress(mint, 4, 4)})</span>}
      <span className={`ml-auto ${positive ? "text-success" : "text-danger"}`}>
        {positive ? "+" : ""}
        {delta} {unit}
      </span>
    </div>
  );
}
