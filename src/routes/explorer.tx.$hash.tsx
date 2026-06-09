import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { useExplorer } from "@/hooks/useExplorer";
import {
  Card,
  Row,
  StatusPill,
  AddrLink,
  BlockLink,
  CopyBtn,
  Tabs,
  Spinner,
  Empty,
} from "@/components/explorer/ui";
import { formatQie, formatUnits, formatGwei, timeAgo, withCommas } from "@/lib/explorer/format";
import type { ExTx, ExLog, ExTokenTransfer } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/tx/$hash")({
  head: () => ({ meta: [{ title: "Transaction - QIE Explorer" }] }),
  component: TxPage,
});

interface TxDetail extends ExTx {
  gas_used?: string | null;
  decoded_input?: {
    method_call?: string;
    parameters?: Array<{ name: string; type: string; value: unknown }>;
  } | null;
  raw_input?: string;
  confirmations?: number;
  type?: number;
  max_fee_per_gas?: string | null;
  max_priority_fee_per_gas?: string | null;
  base_fee_per_gas?: string | null;
  token_transfers?: ExTokenTransfer[];
}

function TxPage() {
  const { hash } = Route.useParams();
  const [tab, setTab] = useState("overview");
  const { data: tx, isLoading, error } = useExplorer<TxDetail>(`/transactions/${hash}`);
  const { data: logs } = useExplorer<{ items: ExLog[] }>(`/transactions/${hash}/logs`, {
    enabled: tab === "logs",
  });

  if (isLoading) return <Spinner label="Loading transaction" />;
  if (error || !tx) return <NotFound what="transaction" hash={hash} message={error?.message} />;

  const ok = tx.status === "ok";
  const transfers = tx.token_transfers ?? [];

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 font-mono text-lg font-bold text-foreground">
        Transaction Details
      </h1>

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "logs", label: "Logs" },
          { id: "input", label: "Input Data" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && (
        <Card>
          <Row label="Transaction Hash">
            <span className="flex items-center gap-1.5 break-all">
              {tx.hash} <CopyBtn value={tx.hash} />
            </span>
          </Row>
          <Row label="Status">
            <span className="flex items-center gap-2">
              <StatusPill ok={ok} />
              {!ok && tx.result && <span className="text-danger">{tx.result}</span>}
            </span>
          </Row>
          <Row label="Block">
            <span className="flex items-center gap-2">
              {tx.block_number != null ? <BlockLink height={tx.block_number} /> : "Pending"}
              {tx.confirmations != null && (
                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-meta">
                  {withCommas(tx.confirmations)} confirmations
                </span>
              )}
            </span>
          </Row>
          <Row label="Timestamp">
            {tx.timestamp
              ? `${timeAgo(tx.timestamp)}  (${new Date(tx.timestamp).toUTCString()})`
              : "—"}
          </Row>
          {tx.method && (
            <Row label="Method">
              <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5">
                {tx.method}
              </span>
            </Row>
          )}
          <Row label="From">
            {tx.from ? (
              <span className="flex items-center gap-1.5">
                <AddrLink
                  hash={tx.from.hash}
                  name={tx.from.name}
                  short={false}
                  isContract={tx.from.is_contract}
                />
                <CopyBtn value={tx.from.hash} />
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row label={tx.created_contract ? "Contract Created" : "To"}>
            {tx.to ? (
              <span className="flex items-center gap-1.5">
                <AddrLink
                  hash={tx.to.hash}
                  name={tx.to.name}
                  short={false}
                  isContract={tx.to.is_contract}
                />
                <CopyBtn value={tx.to.hash} />
              </span>
            ) : tx.created_contract ? (
              <span className="flex items-center gap-1.5">
                <AddrLink hash={tx.created_contract.hash} short={false} isContract />
                <CopyBtn value={tx.created_contract.hash} />
              </span>
            ) : (
              "—"
            )}
          </Row>
          {transfers.length > 0 && (
            <Row label="Tokens Transferred">
              <div className="space-y-1">
                {transfers.slice(0, 12).map((t, i) => (
                  <TokenTransferLine key={i} t={t} />
                ))}
              </div>
            </Row>
          )}
          <Row label="Value">{formatQie(tx.value)} QIE</Row>
          <Row label="Transaction Fee">{formatUnits(tx.fee?.value, 18, 12)} QIE</Row>
          <Row label="Gas Price">{formatGwei(tx.gas_price)}</Row>
          <Row label="Gas Limit & Usage">
            {withCommas(tx.gas_limit ?? "0")}
            {tx.gas_used && (
              <span className="text-muted-foreground">
                {" "}
                | {withCommas(tx.gas_used)} (
                {tx.gas_limit
                  ? ((Number(tx.gas_used) / Number(tx.gas_limit)) * 100).toFixed(2)
                  : "0"}
                %)
              </span>
            )}
          </Row>
          {(tx.base_fee_per_gas || tx.max_fee_per_gas) && (
            <Row label="Gas Fees (EIP-1559)">
              <span className="text-muted-foreground">
                {tx.base_fee_per_gas && <>Base: {formatGwei(tx.base_fee_per_gas)} </>}
                {tx.max_fee_per_gas && <>· Max: {formatGwei(tx.max_fee_per_gas)} </>}
                {tx.max_priority_fee_per_gas && (
                  <>· Priority: {formatGwei(tx.max_priority_fee_per_gas)}</>
                )}
              </span>
            </Row>
          )}
          <Row label="Nonce">{tx.nonce ?? "—"}</Row>
          <Row label="Decode / trace">
            <Link
              to="/routebook/$txHash"
              params={{ txHash: tx.hash }}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              <SearchIcon className="h-3.5 w-3.5" /> Open the decoded call tree in Routebook
            </Link>
          </Row>
        </Card>
      )}

      {tab === "logs" && (
        <Card title={`Event Logs ${logs ? `(${logs.items.length})` : ""}`}>
          {!logs ? (
            <Spinner />
          ) : logs.items.length === 0 ? (
            <Empty>No event logs for this transaction.</Empty>
          ) : (
            <div className="divide-y divide-border">
              {logs.items.map((log, i) => (
                <LogItem key={i} log={log} />
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "input" && (
        <Card title="Input Data">
          {tx.decoded_input ? (
            <div className="space-y-3 p-4">
              <div className="font-mono text-xs text-foreground">
                {tx.decoded_input.method_call}
              </div>
              <table className="w-full font-mono text-[11px]">
                <thead className="text-meta">
                  <tr>
                    <th className="px-2 py-1 text-left font-normal">Name</th>
                    <th className="px-2 py-1 text-left font-normal">Type</th>
                    <th className="px-2 py-1 text-left font-normal">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {(tx.decoded_input.parameters ?? []).map((p, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-2 py-1 text-foreground">{p.name}</td>
                      <td className="px-2 py-1 text-info">{p.type}</td>
                      <td className="px-2 py-1 break-all text-muted-foreground">
                        {String(p.value)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="overflow-x-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {tx.raw_input || "0x"}
            </pre>
          )}
        </Card>
      )}
    </div>
  );
}

function TokenTransferLine({ t }: { t: ExTokenTransfer }) {
  const sym = t.token?.symbol ?? "tokens";
  const dec = t.token?.decimals ? Number(t.token.decimals) : 18;
  const amt = t.total?.value
    ? formatUnits(t.total.value, dec, 6)
    : t.total?.token_id
      ? `#${t.total.token_id}`
      : "";
  return (
    <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      From {t.from ? <AddrLink hash={t.from.hash} name={t.from.name} /> : "—"} to{" "}
      {t.to ? <AddrLink hash={t.to.hash} name={t.to.name} /> : "—"} for{" "}
      <span className="text-foreground">
        {amt} {sym}
      </span>
    </span>
  );
}

function LogItem({ log }: { log: ExLog }) {
  return (
    <div className="space-y-1.5 px-4 py-3 font-mono text-[11px]">
      <div className="flex items-center gap-2">
        <span className="text-meta">Address</span>
        <AddrLink hash={log.address.hash} name={log.address.name} isContract />
      </div>
      {log.decoded?.method_call && <div className="text-foreground">{log.decoded.method_call}</div>}
      {log.topics.filter(Boolean).map((topic, i) => (
        <div key={i} className="flex gap-2 break-all">
          <span className="shrink-0 text-meta">[topic{i}]</span>
          <span className="text-muted-foreground">{topic}</span>
        </div>
      ))}
      {log.data && log.data !== "0x" && (
        <div className="flex gap-2 break-all">
          <span className="shrink-0 text-meta">data</span>
          <span className="text-muted-foreground">{log.data}</span>
        </div>
      )}
    </div>
  );
}

function NotFound({ what, hash, message }: { what: string; hash: string; message?: string }) {
  return (
    <Card title={`No ${what} found`}>
      <div className="px-4 py-8 font-mono text-xs text-meta">
        <p className="break-all">
          Could not load {what} <span className="text-muted-foreground">{hash}</span>.
        </p>
        {message && <p className="mt-1 text-danger">{message}</p>}
      </div>
    </Card>
  );
}
