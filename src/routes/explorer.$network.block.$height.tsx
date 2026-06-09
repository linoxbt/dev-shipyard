import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useExplorer } from "@/hooks/useExplorer";
import { Card, Row, AddrLink, CopyBtn, Tabs, Spinner } from "@/components/explorer/ui";
import { TxTable } from "@/components/explorer/lists";
import { formatQie, formatGwei, timeAgo, withCommas } from "@/lib/explorer/format";
import { isNetworkSlug, type NetworkSlug } from "@/lib/explorer/network";
import type { ExBlock, ExTx } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/block/$height")({
  head: () => ({ meta: [{ title: "Block - QIE Explorer" }] }),
  component: BlockPage,
});

function BlockPage() {
  const { network, height } = Route.useParams();
  const slug = (isNetworkSlug(network) ? network : "testnet") as NetworkSlug;
  const [tab, setTab] = useState("overview");
  const { data: block, isLoading, error } = useExplorer<ExBlock>(`/blocks/${height}`);
  const { data: txs } = useExplorer<{ items: ExTx[] }>(`/blocks/${height}/transactions`, {
    enabled: tab === "txns",
  });

  if (isLoading) return <Spinner label="Loading block" />;
  if (error || !block)
    return (
      <Card title="Block not found">
        <div className="px-4 py-8 font-mono text-xs text-meta">
          Could not load block {height}. {error?.message}
        </div>
      </Card>
    );

  const n = block.height;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="font-mono text-lg font-bold text-foreground">Block #{withCommas(n)}</h1>
        <div className="flex items-center gap-1">
          <Link
            to="/explorer/$network/block/$height"
            params={{ network: slug, height: String(n - 1) }}
            className="rounded border border-border p-1 text-meta hover:border-primary hover:text-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/explorer/$network/block/$height"
            params={{ network: slug, height: String(n + 1) }}
            className="rounded border border-border p-1 text-meta hover:border-primary hover:text-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "txns", label: "Transactions", count: block.transaction_count },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "overview" && (
        <Card>
          <Row label="Block Height">{withCommas(n)}</Row>
          <Row label="Timestamp">
            {block.timestamp
              ? `${timeAgo(block.timestamp)}  (${new Date(block.timestamp).toUTCString()})`
              : "—"}
          </Row>
          <Row label="Transactions">
            {block.transaction_count > 0 ? (
              <button onClick={() => setTab("txns")} className="text-info hover:underline">
                {block.transaction_count} transactions
              </button>
            ) : (
              "0 transactions"
            )}{" "}
            in this block
          </Row>
          <Row label="Mined by">
            {block.miner ? (
              <span className="flex items-center gap-1.5">
                <AddrLink hash={block.miner.hash} name={block.miner.name} short={false} />
                <CopyBtn value={block.miner.hash} />
              </span>
            ) : (
              "—"
            )}
          </Row>
          {block.rewards?.[0] && (
            <Row label="Block Reward">{formatQie(block.rewards[0].reward)} QIE</Row>
          )}
          <Row label="Gas Used">
            {withCommas(block.gas_used)}
            {block.gas_used_percentage != null && (
              <span className="text-muted-foreground">
                {" "}
                ({block.gas_used_percentage.toFixed(2)}%)
              </span>
            )}
          </Row>
          <Row label="Gas Limit">{withCommas(block.gas_limit)}</Row>
          {block.base_fee_per_gas && (
            <Row label="Base Fee Per Gas">{formatGwei(block.base_fee_per_gas)}</Row>
          )}
          {block.burnt_fees && <Row label="Burnt Fees">{formatQie(block.burnt_fees)} QIE</Row>}
          <Row label="Size">{withCommas(block.size)} bytes</Row>
          <Row label="Hash">
            <span className="flex items-center gap-1.5 break-all">
              {block.hash} <CopyBtn value={block.hash} />
            </span>
          </Row>
          {block.parent_hash && (
            <Row label="Parent Hash">
              <Link
                to="/explorer/$network/block/$height"
                params={{ network: slug, height: String(n - 1) }}
                className="break-all text-info hover:underline"
              >
                {block.parent_hash}
              </Link>
            </Row>
          )}
          {block.nonce && <Row label="Nonce">{block.nonce}</Row>}
          {block.difficulty && <Row label="Difficulty">{withCommas(block.difficulty)}</Row>}
        </Card>
      )}

      {tab === "txns" && (
        <Card title="Transactions in this block">
          {!txs ? <Spinner /> : <TxTable txs={txs.items} />}
        </Card>
      )}
    </div>
  );
}
