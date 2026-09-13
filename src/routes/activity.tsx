import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";
import { createFileRoute } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { LayoutDashboard } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { BuilderDashboard } from "@/components/builder/BuilderDashboard";

// Your builder dashboard: everything DevStation knows about the connected
// wallet, across every network it runs on. The same view anyone sees at
// /dev/<your address>, plus the work and actions that are only yours.

export const Route = createFileRoute("/activity")({
  head: () => ({ meta: [{ title: "Dashboard: DevStation" }] }),
  // Gated on the shared map, never on a flag local to this file: the sidebar
  // badge reads the same entry, so the two cannot disagree. DashboardPage stays
  // referenced, so removing the map entry is all it takes to bring it back.
  component: () =>
    isComingSoon("/activity") ? <ComingSoon path="/activity" /> : <DashboardPage />,
});

function DashboardPage() {
  const { address, isConnected } = useAccount();

  if (!isConnected || !address) {
    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "Dashboard"]}
          title="Builder dashboard"
          subtitle="Your contracts, apps, marketplace earnings, reputation and QIE ID, in one place."
        />
        <div className="px-5 py-6 sm:px-8 lg:px-12">
          <div className="rounded-xl border border-dashed border-border p-12 text-center">
            <LayoutDashboard className="mx-auto h-7 w-7 text-meta" />
            <p className="mt-3 font-mono text-sm text-foreground">
              Connect a wallet to see your dashboard
            </p>
            <p className="mx-auto mt-1 max-w-md font-mono text-[11px] text-meta">
              Everything here belongs to one wallet and is read from chain: what you deployed, sold
              and published, and the .qie names you hold.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Dashboard"]}
        title="Builder dashboard"
        subtitle="Your contracts, apps, marketplace earnings, reputation and QIE ID, in one place."
      />
      <BuilderDashboard address={address} owner />
    </div>
  );
}
