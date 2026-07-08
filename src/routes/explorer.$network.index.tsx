import { createFileRoute, Link } from "@tanstack/react-router";
import { Boxes, FileText, Coins, BarChart3, Activity, Gauge, DollarSign } from "lucide-react";
import { useExplorer } from "@/hooks/useExplorer";
import { SearchBar } from "@/components/explorer/SearchBar";
import { Card, Spinner } from "@/components/explorer/ui";
import { TxFeed, BlockFeed, ViewAll } from "@/components/explorer/lists";
import { ExplorerCharts } from "@/components/explorer/Charts";
import { ClientOnly } from "@/components/shared/ClientOnly";
import { useStatsOverview, StatsGrid } from "@/components/explorer/StatsOverview";
import {
  networkLabel,
  isNetworkSlug,
  chainIdForSlug,
  familyForSlug,
  DEFAULT_NETWORK_SLUG,
  type NetworkSlug,
} from "@/lib/explorer/network";
import { nativeSymbol } from "@/lib/chains";
import type { ExTx, ExBlock } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/")({
  component: ExplorerHome,
});

function ExplorerHome() {
  const { network } = Route.useParams();
  const slug = (isNetworkSlug(network) ? network : DEFAULT_NETWORK_SLUG) as NetworkSlug;
  const chainId = chainIdForSlug(slug);
  const symbol = nativeSymbol(chainId);
  const family = familyForSlug(slug);
  const { stats, gas, coinPrice, change24h, marketCap } = useStatsOverview(chainId);
  const { data: blocks } = useExplorer<ExBlock[]>("/main-page/blocks", { refetchInterval: 12_000 });
  const { data: txs } = useExplorer<ExTx[]>("/main-page/transactions", { refetchInterval: 12_000 });

  return (
    <div className="space-y-5">
      <SearchBar />

      <StatsGrid
        symbol={symbol}
        stats={stats}
        gas={gas}
        coinPrice={coinPrice}
        change24h={change24h}
        marketCap={marketCap}
      />

      {/* Quick links */}
      <div className="flex flex-wrap gap-2 font-mono text-[11px]">
        <QuickLink
          to="/explorer/$network/txns"
          network={slug}
          icon={FileText}
          label="Transactions"
        />
        <QuickLink to="/explorer/$network/blocks" network={slug} icon={Boxes} label="Blocks" />
        <QuickLink to="/explorer/$network/tokens" network={slug} icon={Coins} label="Tokens" />
        <QuickLink to="/explorer/$network/stats" network={slug} icon={BarChart3} label="Stats" />
        <span className="ml-auto inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-meta">
          <Activity className="h-3.5 w-3.5 text-success" /> {family.label} {networkLabel(slug)}
          {stats?.network_utilization_percentage != null && (
            <>
              <Gauge className="ml-2 h-3.5 w-3.5" />{" "}
              {stats.network_utilization_percentage.toFixed(0)}% util
            </>
          )}
        </span>
      </div>

      {/* Analytics charts */}
      <ClientOnly fallback={<div className="h-56" />}>
        <ExplorerCharts symbol={symbol} />
      </ClientOnly>

      {/* Latest blocks + transactions */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Latest Blocks"
          action={<ViewAll to="/explorer/$network/blocks" label="View all blocks →" />}
        >
          {blocks ? <BlockFeed blocks={blocks.slice(0, 6)} /> : <Spinner />}
        </Card>
        <Card
          title="Latest Transactions"
          action={<ViewAll to="/explorer/$network/txns" label="View all transactions →" />}
        >
          {txs ? <TxFeed txs={txs.slice(0, 6)} symbol={symbol} /> : <Spinner />}
        </Card>
      </div>

      <p className="flex items-center gap-1.5 font-mono text-[10px] text-meta">
        <DollarSign className="h-3 w-3" /> Live {family.label} {networkLabel(slug)} data. Prices and
        stats update automatically.
      </p>
    </div>
  );
}

function QuickLink({
  to,
  network,
  icon: Icon,
  label,
}: {
  to:
    | "/explorer/$network/txns"
    | "/explorer/$network/blocks"
    | "/explorer/$network/tokens"
    | "/explorer/$network/stats";
  network: NetworkSlug;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <Link
      to={to}
      params={{ network }}
      className="inline-flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 text-muted-foreground hover:border-primary hover:text-primary"
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}
