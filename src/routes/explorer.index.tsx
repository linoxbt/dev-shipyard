import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, FileText, Coins, Activity, Gauge, DollarSign } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useExplorer } from "@/hooks/useExplorer";
import { SearchBar } from "@/components/explorer/SearchBar";
import { StatCard, Card, Spinner } from "@/components/explorer/ui";
import { TxFeed, BlockFeed, ViewAll } from "@/components/explorer/lists";
import { withCommas, formatGwei } from "@/lib/explorer/format";
import type { ExStats, ExTx, ExBlock } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/")({
  head: () => ({ meta: [{ title: "QIE Explorer - DevStation" }] }),
  component: ExplorerHome,
});

function ExplorerHome() {
  const { chain } = useActiveChain();
  const { data: stats } = useExplorer<ExStats>("/stats", { refetchInterval: 20_000 });
  const { data: blocks } = useExplorer<ExBlock[]>("/main-page/blocks", { refetchInterval: 12_000 });
  const { data: txs } = useExplorer<ExTx[]>("/main-page/transactions", { refetchInterval: 12_000 });

  const gas = stats?.gas_prices?.average;

  return (
    <div className="space-y-5">
      <SearchBar />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="QIE Price"
          value={stats?.coin_price ? `$${Number(stats.coin_price).toLocaleString()}` : "—"}
          sub={
            stats?.coin_price_change_percentage != null ? (
              <span
                className={stats.coin_price_change_percentage >= 0 ? "text-success" : "text-danger"}
              >
                {stats.coin_price_change_percentage >= 0 ? "+" : ""}
                {stats.coin_price_change_percentage.toFixed(2)}%
              </span>
            ) : undefined
          }
        />
        <StatCard
          label="Market Cap"
          value={stats?.market_cap ? `$${withCommas(Number(stats.market_cap).toFixed(0))}` : "—"}
        />
        <StatCard
          label="Avg Block Time"
          value={
            stats?.average_block_time ? `${(stats.average_block_time / 1000).toFixed(1)}s` : "—"
          }
        />
        <StatCard
          label="Total Blocks"
          value={stats?.total_blocks ? withCommas(stats.total_blocks) : "—"}
        />
        <StatCard
          label="Total Transactions"
          value={stats?.total_transactions ? withCommas(stats.total_transactions) : "—"}
        />
        <StatCard label="Gas Price" value={gas != null ? formatGwei(String(gas * 1e9)) : "—"} />
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 font-mono text-[11px]">
        <QuickLink to="/explorer/txns" icon={FileText} label="Transactions" />
        <QuickLink to="/explorer/blocks" icon={Boxes} label="Blocks" />
        <QuickLink to="/explorer/tokens" icon={Coins} label="Tokens" />
        <span className="ml-auto inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-meta">
          <Activity className="h-3.5 w-3.5 text-success" /> {chain.name}
          {stats?.network_utilization_percentage != null && (
            <>
              <Gauge className="ml-2 h-3.5 w-3.5" />{" "}
              {stats.network_utilization_percentage.toFixed(0)}% util
            </>
          )}
        </span>
      </div>

      {/* Latest blocks + transactions */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Latest Blocks"
          action={<ViewAll to="/explorer/blocks" label="View all blocks →" />}
        >
          {blocks ? <BlockFeed blocks={blocks.slice(0, 6)} /> : <Spinner />}
        </Card>
        <Card
          title="Latest Transactions"
          action={<ViewAll to="/explorer/txns" label="View all transactions →" />}
        >
          {txs ? <TxFeed txs={txs.slice(0, 6)} /> : <Spinner />}
        </Card>
      </div>

      <p className="flex items-center gap-1.5 font-mono text-[10px] text-meta">
        <DollarSign className="h-3 w-3" /> Live data from the {chain.name} explorer. Prices and
        stats update automatically.
      </p>
    </div>
  );
}

function QuickLink({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-muted-foreground hover:border-primary hover:text-primary"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}
