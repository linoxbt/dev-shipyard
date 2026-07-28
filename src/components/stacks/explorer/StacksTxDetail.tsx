import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  ShieldCheck,
  ShieldAlert,
  Shield,
  ArrowRight,
  Cpu,
  Terminal,
} from "lucide-react";
import { getStacksTx } from "@/lib/api/stacks-explorer.functions";
import { type StacksNetworkId } from "@/lib/stacks/chains";
import { coverageLabel } from "@/lib/stacks/audit";
import { truncateAddress } from "@/lib/wallet";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function StacksTxDetail({ network, txid }: { network: StacksNetworkId; txid: string }) {
  const q = useQuery({
    queryKey: ["stx-tx-detail", network, txid],
    queryFn: () => getStacksTx({ data: { network, txid } }),
  });
  const d = q.data;
  const cov = d?.ok && d.auditResult ? coverageLabel(d.auditResult.coverage) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-mono text-lg font-bold text-foreground">Transaction</h1>
      </div>
      {q.isLoading && <Loader2 className="h-4 w-4 animate-spin text-meta" />}
      {d && !d.ok && (
        <div className="rounded border border-danger/40 bg-danger/10 p-4 font-mono text-sm text-danger">
          {d.error}
        </div>
      )}
      {d && d.ok && (
        <>
          <Section title="Overview">
            <Row label="Status">
              {d.status === "success" ? (
                <span className="inline-flex items-center gap-1 text-success">
                  <CheckCircle2 className="h-4 w-4" /> Success
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-danger">
                  <XCircle className="h-4 w-4" /> {d.status}
                </span>
              )}
            </Row>
            <Row label="Type">{d.type}</Row>
            <Row label="Transaction ID">
              <span className="break-all">{d.txid}</span>
            </Row>
            <Row label="Sender">
              <Link
                to="/explorer/$network/address/$hash"
                params={{ network, hash: d.sender }}
                className="break-all text-primary hover:underline"
              >
                {d.sender}
              </Link>
            </Row>
            {d.contractId && (
              <Row label="Contract">
                <Link
                  to="/explorer/$network/address/$hash"
                  params={{ network, hash: d.contractId }}
                  className="break-all text-primary hover:underline"
                >
                  {d.contractId}
                </Link>
              </Row>
            )}
            {d.method && <Row label="Function">{d.method}</Row>}
            <Row label="Nonce">{d.nonce ?? "—"}</Row>
            <Row label="Fee">{d.feeStx} STX</Row>
            {d.sponsored && (
              <Row label="Sponsor">
                {d.sponsorAddress ? (
                  <Link
                    to="/explorer/$network/address/$hash"
                    params={{ network, hash: d.sponsorAddress }}
                    className="break-all text-primary hover:underline"
                  >
                    {d.sponsorAddress}
                  </Link>
                ) : (
                  "yes"
                )}
              </Row>
            )}
            {d.blockHeight && (
              <Row label="Block">
                <Link
                  to="/explorer/$network/block/$height"
                  params={{ network, height: String(d.blockHeight) }}
                  className="text-primary hover:underline"
                >
                  #{d.blockHeight}
                </Link>
              </Row>
            )}
            <Row label="Time">{d.blockTime ? new Date(d.blockTime * 1000).toUTCString() : "—"}</Row>
            {d.txResult && (
              <Row label="Result">
                <span className="break-all text-foreground">{d.txResult.repr}</span>
              </Row>
            )}
          </Section>

          {/* Plain STX transfer — the one tx type with no contract_call fields,
              so without this a "send STX" tx showed nothing but sender/nonce/fee. */}
          {d.tokenTransfer && (
            <Section title="Transfer">
              <Row label="Recipient">
                <Link
                  to="/explorer/$network/address/$hash"
                  params={{ network, hash: d.tokenTransfer.recipient }}
                  className="break-all text-primary hover:underline"
                >
                  {d.tokenTransfer.recipient}
                </Link>
              </Row>
              <Row label="Amount">{d.tokenTransfer.amountStx} STX</Row>
              {d.tokenTransfer.memoHex && (
                <Row label="Memo">
                  <span className="break-all text-muted-foreground">{d.tokenTransfer.memoHex}</span>
                </Row>
              )}
            </Section>
          )}

          {/* Execution cost — the Stacks (Clarity VM) analog of EVM gas usage. */}
          {d.execCost && d.execCost.runtime !== null && (
            <Section title="Execution Cost">
              <div className="grid grid-cols-2 gap-3 p-3 font-mono text-[11px] sm:grid-cols-5">
                <Cost icon={Cpu} label="Runtime" value={d.execCost.runtime} />
                <Cost icon={Terminal} label="Read count" value={d.execCost.readCount} />
                <Cost icon={Terminal} label="Read length" value={d.execCost.readLength} />
                <Cost icon={Terminal} label="Write count" value={d.execCost.writeCount} />
                <Cost icon={Terminal} label="Write length" value={d.execCost.writeLength} />
              </div>
            </Section>
          )}

          {/* Function arguments */}
          {d.args.length > 0 && (
            <Section title="Function arguments">
              {d.args.map((a: any, i: number) => (
                <div
                  key={i}
                  className="border-b border-border px-4 py-2 font-mono text-xs last:border-0"
                >
                  <span className="text-meta">{a.name}</span>{" "}
                  <span className="text-foreground">{a.type}</span>
                  <div className="mt-0.5 break-all text-muted-foreground">{a.repr}</div>
                </div>
              ))}
            </Section>
          )}

          {/* Post-Condition Coverage — the differentiator */}
          {cov && d.auditResult && (
            <div className="rounded border border-border bg-surface">
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-foreground">
                  {cov.tone === "good" ? (
                    <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  ) : cov.tone === "warn" ? (
                    <Shield className="h-3.5 w-3.5 text-warning" />
                  ) : (
                    <ShieldAlert className="h-3.5 w-3.5 text-danger" />
                  )}
                  Post-Condition Coverage
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${cov.tone === "good" ? "border-success/40 bg-success/10 text-success" : cov.tone === "warn" ? "border-warning/40 bg-warning/10 text-warning" : "border-danger/40 bg-danger/10 text-danger"}`}
                >
                  {cov.text}
                </span>
              </div>
              <div className="space-y-1.5 p-3 font-mono text-[11px]">
                <div className="text-meta">
                  {d.postConditions.length} declared · mode {d.postConditionMode} ·{" "}
                  {d.auditResult.transferPaths.length} transfer paths
                </div>
                {d.postConditions.map((pc: any, i: number) => (
                  <div
                    key={i}
                    className="rounded border border-border p-2 text-[10px] text-muted-foreground"
                  >
                    <span className="text-foreground">{pc.principal || "—"}</span> · {pc.type} ·{" "}
                    {pc.condition}
                    {pc.amount != null && <> · {pc.amount}</>}
                    {pc.asset && <> · {pc.asset}</>}
                  </div>
                ))}
                {d.auditResult.details.map((det: any, i: number) => (
                  <div key={i} className="rounded border border-border p-2 text-[10px]">
                    <span
                      className={
                        det.status === "covered"
                          ? "text-success"
                          : det.status === "unknown-risk"
                            ? "text-warning"
                            : "text-danger"
                      }
                    >
                      ● {det.functionName} · {det.assetType} · {det.status}
                    </span>
                    <div className="mt-0.5 text-muted-foreground">{det.note}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Asset events */}
          {d.events.length > 0 && (
            <Section title={`Events (${d.eventCount})`}>
              {d.events.map((ev: any, i: number) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 font-mono text-[11px] last:border-0"
                >
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-meta">{ev.type}</span>
                  <span className="text-foreground">{ev.action}</span>
                  {ev.sender && (
                    <span className="text-muted-foreground">
                      {truncateAddress(ev.sender, 4, 4)}
                    </span>
                  )}
                  {ev.recipient && <ArrowRight className="h-3 w-3 text-meta" />}
                  {ev.recipient && (
                    <span className="text-muted-foreground">
                      {truncateAddress(ev.recipient, 4, 4)}
                    </span>
                  )}
                  {ev.amount != null && (
                    <span className="ml-auto text-foreground">{String(ev.amount)}</span>
                  )}
                  {ev.assetId && <span className="w-full truncate text-meta">{ev.assetId}</span>}
                </div>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        {title}
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
function Cost({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Cpu;
  label: string;
  value: number | null;
}) {
  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="mb-1 flex items-center gap-1 text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="text-foreground">{value !== null ? value.toLocaleString() : "—"}</div>
    </div>
  );
}
