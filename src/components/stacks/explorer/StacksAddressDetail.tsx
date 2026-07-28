import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2, ExternalLink, ShieldCheck, ShieldAlert, Shield, Coins, Cpu, FileCode2 } from "lucide-react";
import { getStacksAddress } from "@/lib/api/stacks-explorer.functions";
import { stacksExplorerLink, type StacksNetworkId } from "@/lib/stacks/chains";
import { coverageLabel } from "@/lib/stacks/audit";
import { ReadOnlyCaller } from "@/components/stacks/explorer/ReadOnlyCaller";
import { WriteCaller } from "@/components/stacks/explorer/WriteCaller";
import { truncateAddress } from "@/lib/wallet";

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACCESS_COLOR: Record<string, string> = { public: "#22c55e", read_only: "#3b82f6", private: "#64748b" };

export function StacksAddressDetail({ network, principal }: { network: StacksNetworkId; principal: string }) {
  const q = useQuery({ queryKey: ["stx-addr", network, principal], queryFn: () => getStacksAddress({ data: { network, principal } }) });
  const d = q.data;
  const cov = d?.ok && d.coverage ? coverageLabel(d.coverage.coverage) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold text-foreground">{d?.ok && d.isContract ? "Contract" : "Address"}</h1>
        <a href={stacksExplorerLink(network, "address", principal)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary">
          Hiro Explorer <ExternalLink className="h-3 w-3" />
        </a>
      </div>
      {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-meta" />}
      {d && !d.ok && <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">{d.error}</div>}
      {d && d.ok && (
        <>
          <Section title="Overview">
            <Row label="Principal"><span className="break-all">{d.principal}</span></Row>
            <Row label="STX balance">{d.stxBalance.toFixed(6)} STX</Row>
            <Row label="Type">{d.isContract ? "Smart contract" : "Standard account"}</Row>
            {d.bnsNames && d.bnsNames.length > 0 && <Row label="BNS names">{d.bnsNames.join(", ")}</Row>}
            <Row label="NFTs held">{d.nftCount}</Row>
          </Section>

          {d.fungible.length > 0 && (
            <Section title="Fungible tokens" icon={Coins}>
              {d.fungible.map((f) => (
                <div key={f.token} className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs last:border-0">
                  <span className="min-w-0 flex-1 truncate text-foreground" title={f.token}>{f.token.split("::")[1] ?? f.token}</span>
                  <span className="text-muted-foreground">{f.balance}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Contract interface — all functions + arg types */}
          {d.isContract && d.contractFns && (
            <div className="rounded border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
                <Cpu className="h-3.5 w-3.5 text-primary" /> Contract functions ({d.contractFns.length})
                {cov && (
                  <span className={`ml-auto inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${cov.tone === "good" ? "border-success/40 text-success" : cov.tone === "warn" ? "border-warning/40 text-warning" : "border-danger/40 text-danger"}`}>
                    {cov.tone === "good" ? <ShieldCheck className="h-3 w-3" /> : cov.tone === "warn" ? <Shield className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
                    {cov.text}
                  </span>
                )}
              </div>
              {d.contractFns.map((f: any) => (
                <div key={f.name} className="border-b border-border px-4 py-2 font-mono text-[11px] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${ACCESS_COLOR[f.access] ?? "#64748b"}22`, color: ACCESS_COLOR[f.access] ?? "#9ca3af" }}>
                      {f.access}
                    </span>
                    <span className="font-bold text-foreground">{f.name}</span>
                    <span className="text-meta">→ {f.outputs}</span>
                  </div>
                  {f.args.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-2 text-muted-foreground">
                      {f.args.map((a: any, i: number) => (
                        <span key={i} className="rounded border border-border px-1.5 py-0.5">
                          {a.name}: <span className="text-foreground">{a.type}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Read-only + write function sandbox (write = initialize/interact) */}
          {d.isContract && d.contractFns && (
            <>
              <ReadOnlyCaller network={network} contractId={d.principal} fns={d.contractFns} />
              <WriteCaller network={network} contractId={d.principal} fns={d.contractFns} />
            </>
          )}

          {/* Contract source */}
          {d.isContract && d.contractSource && (
            <div className="rounded border border-border bg-surface">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
                <FileCode2 className="h-3.5 w-3.5 text-primary" /> Source
              </div>
              <pre className="max-h-96 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">{d.contractSource}</pre>
            </div>
          )}

          <Section title="Transactions">
            {d.txns.map((t) => (
              <Link key={t.txid} to="/explorer/$network/tx/$hash" params={{ network, hash: t.txid }} className="flex items-center gap-2 px-4 py-2 font-mono text-xs hover:bg-surface-2">
                <span className={t.status === "success" ? "text-success" : "text-danger"}>●</span>
                <span className="truncate text-primary">{truncateAddress(t.txid, 10, 8)}</span>
                <span className="text-meta">· {t.type}</span>
                {t.fnName && <span className="text-muted-foreground">· {t.fnName}</span>}
              </Link>
            ))}
            {d.txns.length === 0 && <div className="px-4 py-3 font-mono text-xs text-meta">No transactions</div>}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon?: typeof Coins; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        {Icon && <Icon className="h-3.5 w-3.5 text-primary" />} {title}
      </div>
      <div className="divide-y divide-border">{children}</div>
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-4 py-2.5 font-mono text-xs sm:flex-row sm:items-center sm:gap-4">
      <span className="w-40 shrink-0 text-meta">{label}</span>
      <span className="min-w-0 text-foreground">{children}</span>
    </div>
  );
}
