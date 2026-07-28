import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ClientOnly } from "@/components/shared/ClientOnly";
import { ExplorerCharts } from "@/components/explorer/Charts";
import { useStatsOverview, StatsGrid } from "@/components/explorer/StatsOverview";
import {
  isNetworkSlug,
  chainIdForSlug,
  familyForSlug,
  networkLabel,
  DEFAULT_NETWORK_SLUG,
  type NetworkSlug,
} from "@/lib/explorer/network";
import { nativeSymbol } from "@/lib/chains";

import { isSolanaSlug } from "@/lib/chain-family";
import { SolanaStats } from "@/components/solana/explorer/SolanaStats";

export const Route = createFileRoute("/explorer/$network/stats")({
  head: () => ({ meta: [{ title: "Stats - Explorer" }] }),
  component: StatsRoute,
});

function StatsRoute() {
  const { network } = Route.useParams();
  if (isSolanaSlug(network)) return <SolanaStats cluster={network} />;
  return <StatsPage />;
}

function StatsPage() {
  const { network } = Route.useParams();
  const slug = (isNetworkSlug(network) ? network : DEFAULT_NETWORK_SLUG) as NetworkSlug;
  const chainId = chainIdForSlug(slug);
  const symbol = nativeSymbol(chainId);
  const family = familyForSlug(slug);
  const { stats, gas, coinPrice, change24h, marketCap } = useStatsOverview(chainId);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-5 w-5 text-primary" />
        <h1 className="font-mono text-lg font-bold text-foreground">
          {family.label} {networkLabel(slug)} Stats
        </h1>
      </div>

      <StatsGrid
        symbol={symbol}
        stats={stats}
        gas={gas}
        coinPrice={coinPrice}
        change24h={change24h}
        marketCap={marketCap}
      />

      <ClientOnly fallback={<div className="h-56" />}>
        <ExplorerCharts symbol={symbol} />
      </ClientOnly>
    </div>
  );
}
