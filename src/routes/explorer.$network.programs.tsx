import { createFileRoute, redirect } from "@tanstack/react-router";
import { isSolanaSlug } from "@/lib/chain-family";
import { SolanaPrograms } from "@/components/solana/explorer/SolanaPrograms";

// Programs is a Solana-only explorer page. On an EVM network there's no analog,
// so redirect back to that network's explorer home.
export const Route = createFileRoute("/explorer/$network/programs")({
  beforeLoad: ({ params }) => {
    if (!isSolanaSlug(params.network)) {
      throw redirect({ to: "/explorer/$network", params: { network: params.network } });
    }
  },
  head: () => ({ meta: [{ title: "Programs - Solana Explorer" }] }),
  component: ProgramsRoute,
});

function ProgramsRoute() {
  const { network } = Route.useParams();
  if (isSolanaSlug(network)) return <SolanaPrograms cluster={network} />;
  return null;
}
