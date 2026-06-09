import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Coins } from "lucide-react";
import { useExplorer } from "@/hooks/useExplorer";
import {
  Card,
  StatCard,
  CopyBtn,
  AddrLink,
  TxLink,
  Tabs,
  Spinner,
  Empty,
} from "@/components/explorer/ui";
import { formatUnits, timeAgo, withCommas } from "@/lib/explorer/format";
import type { ExToken, ExHolder, ExTokenTransfer } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/token/$hash")({
  head: () => ({ meta: [{ title: "Token - QIE Explorer" }] }),
  component: TokenPage,
});

function TokenPage() {
  const { hash } = Route.useParams();
  const [tab, setTab] = useState("transfers");
  const { data: token, isLoading } = useExplorer<ExToken>(`/tokens/${hash}`);
  const { data: counters } = useExplorer<{
    token_holders_count?: string;
    transfers_count?: string;
  }>(`/tokens/${hash}/counters`);

  if (isLoading) return <Spinner label="Loading token" />;
  if (!token)
    return (
      <Card title="Token not found">
        <div className="px-4 py-8 font-mono text-xs text-meta break-all">
          Could not load {hash}.
        </div>
      </Card>
    );

  const dec = token.decimals ? Number(token.decimals) : 18;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Coins className="h-5 w-5 text-primary" />
        <h1 className="font-mono text-base font-bold text-foreground">
          {token.name ?? "Token"}{" "}
          {token.symbol && <span className="text-meta">({token.symbol})</span>}
        </h1>
        <span className="ml-1 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-meta">
          {token.type}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          {token.address} <CopyBtn value={token.address} />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total Supply"
          value={token.total_supply ? withCommas(formatUnits(token.total_supply, dec, 4)) : "—"}
          sub={token.symbol ?? undefined}
        />
        <StatCard label="Holders" value={counters?.token_holders_count ?? token.holders ?? "—"} />
        <StatCard label="Transfers" value={counters?.transfers_count ?? "—"} />
        <StatCard label="Decimals" value={token.decimals ?? "—"} />
      </div>

      <Tabs
        tabs={[
          { id: "transfers", label: "Transfers", count: counters?.transfers_count },
          { id: "holders", label: "Holders", count: counters?.token_holders_count },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "transfers" && <TokenTransfers hash={hash} dec={dec} symbol={token.symbol} />}
      {tab === "holders" && (
        <TokenHolders hash={hash} dec={dec} supply={token.total_supply} symbol={token.symbol} />
      )}
    </div>
  );
}

function TokenTransfers({
  hash,
  dec,
  symbol,
}: {
  hash: string;
  dec: number;
  symbol?: string | null;
}) {
  const { data } = useExplorer<{ items: ExTokenTransfer[] }>(`/tokens/${hash}/transfers`);
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (data.items.length === 0)
    return (
      <Card>
        <Empty>No transfers.</Empty>
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
            </tr>
          </thead>
          <tbody>
            {data.items.map((t, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface-2/50">
                <Td>
                  <TxLink hash={t.transaction_hash} />
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(t.timestamp)}</Td>
                <Td>{t.from ? <AddrLink hash={t.from.hash} name={t.from.name} /> : "—"}</Td>
                <Td>{t.to ? <AddrLink hash={t.to.hash} name={t.to.name} /> : "—"}</Td>
                <Td className="text-right text-foreground">
                  {t.total?.value
                    ? formatUnits(t.total.value, dec, 6)
                    : t.total?.token_id
                      ? `#${t.total.token_id}`
                      : "—"}{" "}
                  {symbol}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function TokenHolders({
  hash,
  dec,
  supply,
  symbol,
}: {
  hash: string;
  dec: number;
  supply?: string | null;
  symbol?: string | null;
}) {
  const { data } = useExplorer<{ items: ExHolder[] }>(`/tokens/${hash}/holders`);
  if (!data)
    return (
      <Card>
        <Spinner />
      </Card>
    );
  if (data.items.length === 0)
    return (
      <Card>
        <Empty>No holders.</Empty>
      </Card>
    );
  const total = supply ? Number(supply) : 0;
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="bg-surface-2 text-meta">
            <tr>
              <Th>#</Th>
              <Th>Holder</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Percentage</Th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((h, i) => {
              const pct = total > 0 ? (Number(h.value) / total) * 100 : 0;
              return (
                <tr key={i} className="border-t border-border hover:bg-surface-2/50">
                  <Td className="text-meta">{i + 1}</Td>
                  <Td>
                    <AddrLink hash={h.address.hash} name={h.address.name} short={false} />
                  </Td>
                  <Td className="text-right text-foreground">
                    {h.token_id ? `#${h.token_id}` : formatUnits(h.value, dec, 6)} {symbol}
                  </Td>
                  <Td className="text-right text-muted-foreground">
                    {pct > 0 ? `${pct.toFixed(2)}%` : "—"}
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
