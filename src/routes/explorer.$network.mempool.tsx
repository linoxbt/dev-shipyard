import { createFileRoute, redirect } from "@tanstack/react-router";
import { isStacksNetwork } from "@/lib/stacks/chains";
import { StacksMempool } from "@/components/stacks/explorer/StacksMempool";

// Mempool is a Stacks-only explorer page; other families redirect to the
// network's explorer home.
export const Route = createFileRoute("/explorer/$network/mempool")({
  beforeLoad: ({ params }) => {
    if (!isStacksNetwork(params.network)) {
      throw redirect({ to: "/explorer/$network", params: { network: params.network } });
    }
  },
  head: () => ({ meta: [{ title: "Mempool - Stacks Explorer" }] }),
  component: MempoolRoute,
});

function MempoolRoute() {
  const { network } = Route.useParams();
  if (isStacksNetwork(network)) return <StacksMempool network={network} />;
  return null;
}
