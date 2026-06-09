import { createFileRoute, redirect } from "@tanstack/react-router";
import { useNetworkPref } from "@/lib/active-chain";
import { slugForChainId } from "@/lib/explorer/network";

// Bare /explorer redirects to the network-scoped dashboard for the currently
// selected chain, so the URL always carries /testnet or /mainnet.
export const Route = createFileRoute("/explorer/")({
  beforeLoad: () => {
    const slug = slugForChainId(useNetworkPref.getState().preferredChainId);
    throw redirect({ to: "/explorer/$network", params: { network: slug } });
  },
});
