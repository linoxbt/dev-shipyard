import { useParams } from "@tanstack/react-router";
import { qieTestnet, qieMainnet } from "@/lib/chains";

// The explorer puts the network in the URL (/explorer/testnet, /explorer/mainnet)
// so a link unambiguously refers to one chain. These helpers map between the URL
// slug and the chain id.

export type NetworkSlug = "testnet" | "mainnet";

export function isNetworkSlug(v: string | undefined): v is NetworkSlug {
  return v === "testnet" || v === "mainnet";
}

export function chainIdForSlug(slug: NetworkSlug): number {
  return slug === "mainnet" ? qieMainnet.id : qieTestnet.id;
}

export function slugForChainId(chainId: number): NetworkSlug {
  return chainId === qieMainnet.id ? "mainnet" : "testnet";
}

export function networkLabel(slug: NetworkSlug): string {
  return slug === "mainnet" ? "Mainnet" : "Testnet";
}

// Public, shareable base URL for DevStation's own explorer on a given network,
// e.g. https://devstation.online/explorer/testnet. Used in generated artifacts
// (.env, hackathon submission) so every explorer reference is DevStation's own.
export const DEVSTATION_SITE = "https://devstation.online";
export function devstationExplorerBase(slug: NetworkSlug): string {
  return `${DEVSTATION_SITE}/explorer/${slug}`;
}

// Reads the active explorer network from the route's $network param. Defaults to
// testnet when not inside a network-scoped explorer route.
export function useExplorerNetwork(): NetworkSlug {
  const params = useParams({ strict: false }) as { network?: string };
  return isNetworkSlug(params.network) ? params.network : "testnet";
}
