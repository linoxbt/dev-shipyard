import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";

import { useActiveChain } from "@/hooks/useActiveChain";

import { DevStationAnalytics } from "@/components/analytics/DevStationAnalytics";

import { ChainLogo } from "@/lib/chain-logos";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — DevStation" },
      {
        name: "description",
        content: "DevStation deployment & network analytics for the selected chain.",
      },
    ],
  }),
  component: EvmAnalytics,
});

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
