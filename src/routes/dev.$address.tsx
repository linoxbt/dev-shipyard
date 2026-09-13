import { createFileRoute } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { PageHeader } from "@/components/shared/PageHeader";
import { BuilderDashboard } from "@/components/builder/BuilderDashboard";
import { useQieName } from "@/hooks/useQieIdentity";
import { shortAddr } from "@/lib/explorer/format";

// A builder's public profile, keyed to their wallet: the same dashboard the
// builder sees, minus what lives only in their own browser. Everything on it
// is read from chain, so there is nothing anyone can type in to look better.

export const Route = createFileRoute("/dev/$address")({
  head: ({ params }) => ({
    meta: [{ title: `${shortAddr(params.address)}: DevStation builder` }],
  }),
  component: DeveloperProfile,
});

function DeveloperProfile() {
  const { address } = Route.useParams();
  const { address: connected } = useAccount();
  const valid = /^0x[a-fA-F0-9]{40}$/.test(address);
  const name = useQieName(valid ? address : undefined);

  if (!valid) {
    return (
      <div>
        <PageHeader breadcrumb={["DevStation", "Builders"]} title="Builder" />
        <div className="px-5 py-6 sm:px-8 lg:px-12">
          <p className="font-mono text-xs text-muted-foreground">That is not a wallet address.</p>
        </div>
      </div>
    );
  }

  const owner = !!connected && connected.toLowerCase() === address.toLowerCase();
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Builders", name?.full ?? shortAddr(address)]}
        title={name?.full ?? shortAddr(address)}
        subtitle="Builder profile. Every figure is read from chain and cannot be self-reported."
      />
      <BuilderDashboard address={address} owner={owner} />
    </div>
  );
}
