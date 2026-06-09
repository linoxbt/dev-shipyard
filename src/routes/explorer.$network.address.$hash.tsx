import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Wallet, FileCode2, CheckCircle2 } from "lucide-react";
import { useExplorer } from "@/hooks/useExplorer";
import {
  Card,
  StatCard,
  CopyBtn,
  AddrLink,
  TxLink,
  TokenLink,
  Tabs,
  Spinner,
  Empty,
} from "@/components/explorer/ui";
import { TxTable } from "@/components/explorer/lists";
import { formatQie, formatUnits, timeAgo, withCommas } from "@/lib/explorer/format";
import type {
  ExAddress,
  ExAddrCounters,
  ExTx,
  ExTokenTransfer,
  ExTokenBalance,
  ExLog,
  ExInternalTx,
} from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/address/$hash")({
  head: () => ({ meta: [{ title: "Address - QIE Explorer" }] }),
  component: AddressPage,
});

function AddressPage() {
  const { hash } = Route.useParams();
  const [tab, setTab] = useState("txns");
  const { data: addr, isLoading } = useExplorer<ExAddress>(`/addresses/${hash}`);
  const { data: counters } = useExplorer<ExAddrCounters>(`/addresses/${hash}/counters`);

  if (isLoading) return <Spinner label="Loading address" />;
  if (!addr)
    return (
      <Card title="Address not found">
        <div className="px-4 py-8 font-mono text-xs text-meta break-all">
          Could not load {hash}.
        </div>
      </Card>
    );

  const isContract = addr.is_contract;
  const tabs = [
    { id: "txns", label: "Transactions", count: counters?.transactions_count },
    { id: "transfers", label: "Token Transfers", count: counters?.token_transfers_count },
    { id: "tokens", label: "Tokens" },
    { id: "internal", label: "Internal Txns" },
    { id: "logs", label: "Logs" },
  ];
  if (isContract) tabs.push({ id: "contract", label: "Contract" });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {isContract ? (
          <FileCode2 className="h-5 w-5 text-primary" />
        ) : (
          <Wallet className="h-5 w-5 text-primary" />
        )}
        <h1 className="font-mono text-base font-bold text-foreground">
          {isContract ? "Contract" : "Address"}
        </h1>
        {addr.is_verified && (
          <span className="inline-flex items-center gap-1 rounded border border-success/40 bg-success/10 px-1.5 py-0.5 font-mono text-[10px] text-success">
            <CheckCircle2 className="h-3 w-3" /> Verified
          </span>
        )}
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {addr.hash} <CopyBtn value={addr.hash} />
        </span>
      </div>

      {/* Overview cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Balance" value={`${formatQie(addr.coin_balance)} QIE`} />
        {addr.exchange_rate && (
          <StatCard
            label="Value"
            value={`$${withCommas(
              (Number(formatUnits(addr.coin_balance, 18, 6)) * Number(addr.exchange_rate)).toFixed(
                2,
              ),
            )}`}
          />
        )}
        <StatCard
          label="Transactions"
          value={counters?.transactions_count ? withCommas(counters.transactions_count) : "0"}
        />
        <StatCard
          label="Transfers"
          value={counters?.token_transfers_count ? withCommas(counters.token_transfers_count) : "0"}
        />
      </div>

      {(addr.creator_address_hash || addr.token) && (
        <Card>
          {addr.token && (
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5 font-mono text-xs last:border-0">
              <span className="text-meta">Token</span>
              <TokenLink
                hash={addr.hash}
                label={`${addr.token.name ?? "Token"} (${addr.token.symbol ?? ""})`}
              />
            </div>
          )}
          {addr.creator_address_hash && (
            <div className="flex items-center gap-2 px-4 py-2.5 font-mono text-xs">
              <span className="text-meta">Creator</span>
              <AddrLink hash={addr.creator_address_hash} />
              {addr.creation_transaction_hash && (
                <>
                  <span className="text-meta">at txn</span>
                  <TxLink hash={addr.creation_transaction_hash} />
                </>
              )}
            </div>
          )}
        </Card>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === "txns" && <AddrTxns hash={hash} />}
      {tab === "transfers" && <AddrTransfers hash={hash} />}
      {tab === "tokens" && <AddrTokens hash={hash} />}
      {tab === "internal" && <AddrInternal hash={hash} />}
      {tab === "logs" && <AddrLogs hash={hash} />}
      {tab === "contract" && <ContractTab addr={addr} />}
    </div>
  );
}

function AddrTxns({ hash }: { hash: string }) {
  const { data } = useExplorer<{ items: ExTx[] }>(`/addresses/${hash}/transactions`);
  return <Card>{!data ? <Spinner /> : <TxTable txs={data.items} />}</Card>;
}

function AddrTransfers({ hash }: { hash: string }) {
  const { data } = useExplorer<{ items: ExTokenTransfer[] }>(`/addresses/${hash}/token-transfers`);
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (data.items.length === 0)
    return (
      <Card>
        <Empty>No token transfers.</Empty>
      </Card>
    );
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-surface-2 text-meta">
            <tr>
              <Th>Txn</Th>
              <Th>Age</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th className="text-right">Amount</Th>
              <Th>Token</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((t, i) => {
              const dec = t.token?.decimals ? Number(t.token.decimals) : 18;
              const amt = t.total?.value
                ? formatUnits(t.total.value, dec, 6)
                : t.total?.token_id
                  ? `#${t.total.token_id}`
                  : "—";
              return (
                <tr key={i} className="border-t border-border hover:bg-surface-2/50">
                  <Td>
                    <TxLink hash={t.transaction_hash} />
                  </Td>
                  <Td className="whitespace-nowrap text-muted-foreground">
                    {timeAgo(t.timestamp)}
                  </Td>
                  <Td>{t.from ? <AddrLink hash={t.from.hash} name={t.from.name} /> : "—"}</Td>
                  <Td>{t.to ? <AddrLink hash={t.to.hash} name={t.to.name} /> : "—"}</Td>
                  <Td className="text-right text-foreground">{amt}</Td>
                  <Td>
                    {t.token ? (
                      <TokenLink hash={t.token.address} label={t.token.symbol ?? "Token"} />
                    ) : (
                      "—"
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AddrTokens({ hash }: { hash: string }) {
  const { data } = useExplorer<ExTokenBalance[]>(`/addresses/${hash}/token-balances`);
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (!Array.isArray(data) || data.length === 0)
    return (
      <Card>
        <Empty>No tokens held.</Empty>
      </Card>
    );
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-surface-2 text-meta">
            <tr>
              <Th>Token</Th>
              <Th>Type</Th>
              <Th className="text-right">Balance</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((b, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface-2/50">
                <Td>
                  <TokenLink
                    hash={b.token.address}
                    label={`${b.token.name ?? "Token"} (${b.token.symbol ?? ""})`}
                  />
                </Td>
                <Td className="text-meta">{b.token.type}</Td>
                <Td className="text-right text-foreground">
                  {b.token_id
                    ? `#${b.token_id}`
                    : formatUnits(b.value, b.token.decimals ? Number(b.token.decimals) : 18, 6)}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AddrInternal({ hash }: { hash: string }) {
  const { data } = useExplorer<{ items: ExInternalTx[] }>(
    `/addresses/${hash}/internal-transactions`,
  );
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (data.items.length === 0)
    return (
      <Card>
        <Empty>No internal transactions.</Empty>
      </Card>
    );
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-surface-2 text-meta">
            <tr>
              <Th>Parent Txn</Th>
              <Th>Type</Th>
              <Th>From</Th>
              <Th>To</Th>
              <Th className="text-right">Value (QIE)</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((t, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface-2/50">
                <Td>{t.transaction_hash ? <TxLink hash={t.transaction_hash} /> : "—"}</Td>
                <Td className="text-meta">{t.type ?? "call"}</Td>
                <Td>{t.from ? <AddrLink hash={t.from.hash} name={t.from.name} /> : "—"}</Td>
                <Td>{t.to ? <AddrLink hash={t.to.hash} name={t.to.name} /> : "—"}</Td>
                <Td className="text-right text-foreground">{formatQie(t.value)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function AddrLogs({ hash }: { hash: string }) {
  const { data } = useExplorer<{ items: ExLog[] }>(`/addresses/${hash}/logs`);
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (data.items.length === 0)
    return (
      <Card>
        <Empty>No logs.</Empty>
      </Card>
    );
  return (
    <Card title={`Event Logs (${data.items.length})`}>
      <div className="divide-y divide-border">
        {data.items.map((log, i) => (
          <div key={i} className="space-y-1 px-4 py-3 font-mono text-[11px]">
            {log.transaction_hash && (
              <div className="flex items-center gap-2">
                <span className="text-meta">Txn</span>
                <TxLink hash={log.transaction_hash} />
              </div>
            )}
            {log.decoded?.method_call && (
              <div className="text-foreground">{log.decoded.method_call}</div>
            )}
            {log.topics.filter(Boolean).map((topic, j) => (
              <div key={j} className="flex gap-2 break-all">
                <span className="shrink-0 text-meta">[topic{j}]</span>
                <span className="text-muted-foreground">{topic}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Card>
  );
}

function ContractTab({ addr }: { addr: ExAddress }) {
  const { data } = useExplorer<{
    name?: string;
    is_verified?: boolean;
    source_code?: string;
    compiler_version?: string;
    optimization_enabled?: boolean;
    abi?: unknown;
  }>(`/smart-contracts/${addr.hash}`);

  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );

  if (!data.is_verified && !data.source_code) {
    return (
      <Card title="Contract">
        <div className="space-y-2 px-4 py-6 font-mono text-xs text-meta">
          <p>This contract is not verified on the QIE explorer.</p>
          <p className="text-muted-foreground">
            Deploy through DevStation to auto-submit source for verification, or verify an existing
            deployment from your Projects page.
          </p>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title="Contract Info">
        <div className="px-4 py-3 font-mono text-xs">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
            {data.name && (
              <span>
                Name: <span className="text-foreground">{data.name}</span>
              </span>
            )}
            {data.compiler_version && (
              <span>
                Compiler: <span className="text-foreground">{data.compiler_version}</span>
              </span>
            )}
            {data.optimization_enabled != null && (
              <span>
                Optimization:{" "}
                <span className="text-foreground">{data.optimization_enabled ? "Yes" : "No"}</span>
              </span>
            )}
          </div>
        </div>
      </Card>
      {data.source_code && (
        <Card title="Source Code">
          <pre className="max-h-[600px] overflow-auto p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
            {data.source_code}
          </pre>
        </Card>
      )}
    </div>
  );
}

/* tiny cells */
function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px] ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className ?? ""}`}>{children}</td>;
}
