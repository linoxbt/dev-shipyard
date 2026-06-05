import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronDown, ChevronRight, AlertTriangle, ArrowRight, Share2, Download, Zap } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddressChip } from "@/components/shared/AddressChip";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { findDemoTx, type RouteCall, type DecodedArg } from "@/lib/mock/transactions";
import { findLabel } from "@/lib/mock/labels";
import { CHAIN, ORACLE_RATE_USD, formatUsd } from "@/lib/chain";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/routebook/$txHash")({
  loader: ({ params }) => {
    const tx = findDemoTx(params.txHash);
    if (!tx) {
      // Synthesize an "unknown tx" placeholder
      return { tx: null, hash: params.txHash };
    }
    return { tx, hash: params.txHash };
  },
  head: ({ params }) => ({
    meta: [{ title: `Routebook · ${params.txHash.slice(0, 10)}… — DevStation` }],
  }),
  component: TxView,
});

function TxView() {
  const { tx, hash } = Route.useLoaderData();
  const [tab, setTab] = useState<"route" | "gas">("route");

  if (!tx) {
    return (
      <div>
        <PageHeader breadcrumb={["DevStation", "Routebook"]} title="Transaction Not Found" />
        <div className="p-6">
          <div className="rounded border border-border bg-surface p-8 text-center">
            <div className="font-mono text-sm text-muted-foreground">
              No decoded data found for this hash in DevStation's cache.
            </div>
            <TxHashChip hash={hash} className="mt-3 inline-flex" />
            <p className="mt-4 text-xs text-meta">
              Live RPC decoding is wired up post-MVP. Try one of the demo transactions for now.
            </p>
            <Link
              to="/routebook"
              className="mt-4 inline-block rounded bg-primary px-3 py-1.5 font-mono text-xs text-primary-foreground hover:bg-primary-hover"
            >
              ← Back to Inspector
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const totalGas = tx.gasUsed;

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Routebook", tx.toName ?? "Transaction"]}
        title="Transaction Route"
        subtitle="Decoded execution map · token movements · approvals"
        action={
          <div className="flex gap-2">
            <button
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                toast.success("Route URL copied");
              }}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Share2 className="h-3 w-3" /> Share Route
            </button>
            <button
              onClick={() => {
                const blob = new Blob([JSON.stringify(tx, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `route-${tx.hash.slice(2, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Download className="h-3 w-3" /> Export JSON
            </button>
          </div>
        }
      />

      <div className="space-y-6 p-6">
        {/* Overview Card */}
        <div className="rounded border border-border bg-surface p-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <StatusBadge kind={tx.status === "SUCCESS" ? "SUCCESS" : "REVERTED"} />
            <TxHashChip hash={tx.hash} />
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              Block #{tx.blockNumber.toLocaleString()} ·{" "}
              {formatDistanceToNow(tx.timestamp, { addSuffix: true })}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-3 font-mono text-xs lg:grid-cols-4">
            <OverviewField label="From"><AddressChip address={tx.from} /></OverviewField>
            <OverviewField label="To"><AddressChip address={tx.to} /></OverviewField>
            <OverviewField label="Value">{tx.value} QIE</OverviewField>
            <OverviewField label="Gas Used">{tx.gasUsed.toLocaleString()}</OverviewField>
            <OverviewField label="Gas Price">{tx.gasPriceGwei} Gwei</OverviewField>
            <OverviewField label="Gas Cost">
              {tx.gasCostQIE.toFixed(6)} QIE
              <span className="ml-1 text-meta">({formatUsd(tx.gasCostQIE * ORACLE_RATE_USD)})</span>
            </OverviewField>
            <OverviewField label="Network">{CHAIN.name}</OverviewField>
            <OverviewField label="Chain ID">{CHAIN.id}</OverviewField>
          </dl>
        </div>

        {/* Revert decoder */}
        {tx.status === "REVERTED" && tx.revertReason && (
          <div className="rounded border border-danger/40 bg-danger/5 p-5">
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-danger" />
              <h3 className="font-mono text-sm font-bold uppercase tracking-wider text-danger">
                Transaction Reverted
              </h3>
            </div>
            <div className="space-y-3 font-mono text-xs">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-meta">Reason</div>
                <code className="mt-1 block rounded bg-background px-2 py-1.5 text-danger">
                  {tx.revertReason}
                </code>
              </div>
              {tx.revertExplain && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-meta">What this means</div>
                  <p className="mt-1 text-muted-foreground">{tx.revertExplain}</p>
                </div>
              )}
              {tx.revertFix && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-meta">Suggested fix</div>
                  <p className="mt-1 text-foreground">{tx.revertFix}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div>
          <div className="mb-3 flex gap-1 border-b border-border">
            <TabBtn active={tab === "route"} onClick={() => setTab("route")}>Route Graph</TabBtn>
            <TabBtn active={tab === "gas"} onClick={() => setTab("gas")}>Gas Breakdown</TabBtn>
          </div>

          {tab === "route" ? (
            <div className="grid gap-6 lg:grid-cols-5">
              <div className="lg:col-span-3">
                <RouteNode call={tx.route} depth={0} />
              </div>
              <div className="space-y-4 lg:col-span-2">
                {/* Token Movements */}
                <Panel title="Token Movements">
                  {tx.tokenTransfers.length === 0 ? (
                    <Empty>No token transfers in this transaction.</Empty>
                  ) : (
                    <div className="divide-y divide-border">
                      {tx.tokenTransfers.map((t: import("@/lib/mock/transactions").TokenTransfer, i: number) => (
                        <div key={i} className="px-4 py-3 font-mono text-xs">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="font-bold text-foreground">{t.amount} {t.tokenSymbol}</span>
                          </div>
                          <div className="flex items-center gap-2 text-meta">
                            <AddressChip address={t.from} />
                            <ArrowRight className="h-3 w-3" />
                            <AddressChip address={t.to} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>

                {/* Approvals */}
                {tx.approvals.length > 0 && (
                  <Panel
                    title={
                      <span className="text-warning">⚠ Approvals Detected</span>
                    }
                  >
                    <div className="divide-y divide-border">
                      {tx.approvals.map((a: import("@/lib/mock/transactions").ApprovalRecord, i: number) => (
                        <div key={i} className="px-4 py-3 font-mono text-xs">
                          <div className="text-foreground">
                            {a.tokenSymbol}: {a.unlimited ? "UNLIMITED" : a.amount}
                          </div>
                          <div className="mt-1 text-meta">
                            spender:{" "}
                            <AddressChip address={a.spender} />
                          </div>
                          <div
                            className={cn(
                              "mt-1 text-[10px] uppercase",
                              a.risk === "High" ? "text-danger" : a.risk === "Medium" ? "text-warning" : "text-success",
                            )}
                          >
                            Risk: {a.risk}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Panel>
                )}
              </div>
            </div>
          ) : (
            <GasBreakdown call={tx.route} totalGas={totalGas} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─────── Route tree ─────── */

function RouteNode({ call, depth }: { call: RouteCall; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = call.children.length > 0 || call.events.length > 0;
  const label = findLabel(call.contractAddress);

  const borderColor =
    call.type === "user"
      ? "border-l-primary"
      : call.type === "failed"
      ? "border-l-danger"
      : call.type === "view"
      ? "border-l-meta border-dashed"
      : "border-l-border";

  return (
    <div className={cn("ml-0 mt-2 first:mt-0", depth > 0 && "ml-5")}>
      <div className={cn("rounded border border-border border-l-2 bg-surface", borderColor)}>
        <button
          onClick={() => hasChildren && setOpen(!open)}
          className="flex w-full items-start gap-2 px-3 py-2 text-left"
        >
          {hasChildren ? (
            open ? <ChevronDown className="mt-0.5 h-3 w-3 text-meta" /> : <ChevronRight className="mt-0.5 h-3 w-3 text-meta" />
          ) : (
            <span className="mt-0.5 h-3 w-3" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-baseline gap-2">
              {label ? (
                <span className="font-mono text-sm font-bold text-info">{label.name}</span>
              ) : call.contractName ? (
                <span className="font-mono text-sm font-bold text-primary">{call.contractName}</span>
              ) : (
                <span className="font-mono text-sm font-bold text-danger" title={call.contractAddress}>
                  [Unknown Contract]
                </span>
              )}
              <span className="font-mono text-xs text-code break-all">.{call.fn}</span>
              {call.type === "view" && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-meta">view</span>
              )}
              {call.type === "failed" && (
                <span className="font-mono text-[9px] uppercase tracking-wider text-danger">reverted</span>
              )}
              <span className="ml-auto font-mono text-[10px] text-meta">
                {call.gasUsed.toLocaleString()} gas
              </span>
            </div>
            {open && call.args.length > 0 && (
              <div className="mt-1.5 space-y-0.5">
                {call.args.map((a, i) => (
                  <ArgLine key={i} arg={a} />
                ))}
              </div>
            )}
            {open && call.returns && call.returns.length > 0 && (
              <div className="mt-1.5 border-t border-border pt-1.5">
                <div className="font-mono text-[10px] uppercase tracking-wider text-meta">returns</div>
                {call.returns.map((a, i) => <ArgLine key={i} arg={a} />)}
              </div>
            )}
          </div>
        </button>

        {open && call.events.length > 0 && (
          <div className="border-t border-border bg-background/40 px-3 py-2">
            {call.events.map((ev, i) => (
              <div key={i} className="flex items-start gap-2 py-0.5 font-mono text-xs">
                <Zap className={cn("mt-0.5 h-3 w-3", ev.isApproval ? "text-warning" : "text-success")} />
                <div className="min-w-0 flex-1">
                  <span className={ev.isApproval ? "text-warning" : "text-success"}>
                    {ev.name}
                  </span>
                  <span className="text-meta">(</span>
                  <span className="text-muted-foreground">
                    {ev.args.map((a, j) => (
                      <span key={j}>
                        {j > 0 && ", "}
                        <span className="text-meta">{a.name}:</span>{" "}
                        <span className="text-foreground">{shortenVal(a.value)}</span>
                      </span>
                    ))}
                  </span>
                  <span className="text-meta">)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {open && call.children.length > 0 && (
        <div className="ml-2 border-l border-border pl-2">
          {call.children.map((c) => (
            <RouteNode key={c.id} call={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArgLine({ arg }: { arg: DecodedArg }) {
  const isAddress = arg.type === "address" && /^0x[a-fA-F0-9]{40}$/.test(arg.value);
  return (
    <div className="font-mono text-[11px]">
      <span className="text-meta">{arg.name}:</span>{" "}
      <span className="text-[10px] text-meta">({arg.type})</span>{" "}
      {isAddress ? (
        <AddressChip address={arg.value} />
      ) : (
        <span className="text-foreground">{arg.display ?? shortenVal(arg.value)}</span>
      )}
    </div>
  );
}

function shortenVal(v: string) {
  if (v.length > 64) return v.slice(0, 32) + "…" + v.slice(-8);
  return v;
}

/* ─────── Gas breakdown ─────── */

function flattenCalls(call: RouteCall, acc: RouteCall[] = []): RouteCall[] {
  acc.push(call);
  call.children.forEach((c) => flattenCalls(c, acc));
  return acc;
}

function GasBreakdown({ call, totalGas }: { call: RouteCall; totalGas: number }) {
  const flat = flattenCalls(call);
  return (
    <div className="space-y-4">
      <div className="rounded border border-border bg-surface p-4">
        {flat.map((c) => {
          const pct = (c.gasUsed / totalGas) * 100;
          return (
            <div key={c.id} className="mb-2">
              <div className="flex items-center justify-between font-mono text-[11px]">
                <span className="text-muted-foreground">
                  {c.contractName ?? c.contractAddress.slice(0, 10)}.{c.fn.split("(")[0]}
                </span>
                <span className="text-meta">
                  {c.gasUsed.toLocaleString()} ({pct.toFixed(1)}%)
                </span>
              </div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-background">
                <div
                  className="h-full bg-primary"
                  style={{ width: `${Math.max(pct, 1)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="overflow-hidden rounded border border-border bg-surface">
        <table className="w-full font-mono text-xs">
          <thead className="bg-surface-2 text-meta">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">Contract</th>
              <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">Function</th>
              <th className="px-3 py-2 text-right text-[10px] font-normal uppercase tracking-wider">Gas</th>
              <th className="px-3 py-2 text-right text-[10px] font-normal uppercase tracking-wider">%</th>
              <th className="px-3 py-2 text-right text-[10px] font-normal uppercase tracking-wider">USD</th>
            </tr>
          </thead>
          <tbody>
            {flat.map((c) => {
              const qie = (c.gasUsed * 1.2) / 1e9;
              return (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-foreground">
                    {c.contractName ?? c.contractAddress.slice(0, 10)}
                  </td>
                  <td className="px-3 py-1.5 text-code">{c.fn.split("(")[0]}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{c.gasUsed.toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">{((c.gasUsed/totalGas)*100).toFixed(1)}%</td>
                  <td className="px-3 py-1.5 text-right text-meta">{formatUsd(qie * ORACLE_RATE_USD)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-border bg-surface-2 font-bold">
              <td className="px-3 py-2 text-foreground" colSpan={2}>Total</td>
              <td className="px-3 py-2 text-right text-foreground">{totalGas.toLocaleString()}</td>
              <td className="px-3 py-2 text-right text-muted-foreground">100%</td>
              <td className="px-3 py-2 text-right text-foreground">
                {formatUsd((totalGas * 1.2 / 1e9) * ORACLE_RATE_USD)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─────── tiny helpers ─────── */

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "border-b-2 px-3 py-2 font-mono text-xs transition",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Panel({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div>{children}</div>
    </div>
  );
}

function OverviewField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-meta">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 text-center font-mono text-xs text-meta">{children}</div>;
}
