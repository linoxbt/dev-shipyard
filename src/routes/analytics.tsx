import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { useActiveFamily } from "@/lib/active-network";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { useStacksPref } from "@/lib/stacks/active-stacks";
import { DevStationAnalytics } from "@/components/analytics/DevStationAnalytics";
import { SolanaDevStationAnalytics } from "@/components/analytics/SolanaDevStationAnalytics";
import { StacksDevStationAnalytics } from "@/components/analytics/StacksDevStationAnalytics";
import { ChainLogo } from "@/lib/chain-logos";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — DevStation" },
      { name: "description", content: "DevStation deployment & network analytics for the selected chain." },
    ],
  }),
  component: AnalyticsRoute,
});

function AnalyticsRoute() {
  const family = useActiveFamily((s) => s.family);
  if (family === "solana") return <SolanaAnalytics />;
  if (family === "stacks") return <StacksAnalytics />;
  return <EvmAnalytics />;
}

function StacksAnalytics() {
  const network = useStacksPref((s) => s.network);
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Analytics"]}
        title="DevStation Analytics"
        subtitle={`Clarity deployment activity on Stacks ${network === "stacks-mainnet" ? "Mainnet" : "Testnet"}`}
        action={<ChainLogo family="Stacks" size={24} />}
      />
      <StacksDevStationAnalytics network={network} />
    </div>
  );
}

function EvmAnalytics() {
  const { chain } = useActiveChain();
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Analytics"]}
        title="DevStation Analytics"
        subtitle={`On-chain deployment activity on ${chain.name}`}
        action={<ChainLogo family={chain.name} size={24} />}
      />
      <DevStationAnalytics />
    </div>
  );
}

function SolanaAnalytics() {
  const cluster = useSolanaPref((s) => s.cluster);
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Analytics"]}
        title="DevStation Analytics"
        subtitle={`Deployment activity on Solana ${cluster === "solana-mainnet" ? "Mainnet" : "Devnet"}`}
        action={<ChainLogo family="Solana" size={24} />}
      />
      <SolanaDevStationAnalytics cluster={cluster} />
    </div>
  );
}
