import { useParams } from "@tanstack/react-router";
import { qieTestnet, qieMainnet, botTestnet, botMainnet, DEFAULT_CHAIN } from "@/lib/chains";

// The explorer puts the network in the URL (/explorer/testnet, /explorer/mainnet,
// /explorer/bot-testnet, /explorer/bot-mainnet) so a link unambiguously refers
// to one chain. These helpers map between the URL slug and the chain id.
//
// "testnet"/"mainnet" (no prefix) are QIE's slugs and are never renamed, every
// existing /explorer/testnet and /explorer/mainnet link keeps working exactly
// as before. Other chain families get their own prefixed slugs.
//
// Both supported families are Blockscout-backed (confirmed live per chain -
// see src/lib/chains.ts).

export type NetworkSlug = "testnet" | "mainnet" | "bot-testnet" | "bot-mainnet";

const SLUG_CHAIN_ID: Record<NetworkSlug, number> = {
  testnet: qieTestnet.id,
  mainnet: qieMainnet.id,
  "bot-testnet": botTestnet.id,
  "bot-mainnet": botMainnet.id,
};

export function isNetworkSlug(v: string | undefined): v is NetworkSlug {
  return !!v && Object.prototype.hasOwnProperty.call(SLUG_CHAIN_ID, v);
}

export function chainIdForSlug(slug: NetworkSlug): number {
  return SLUG_CHAIN_ID[slug];
}

export function slugForChainId(chainId: number): NetworkSlug {
  return (
    (Object.keys(SLUG_CHAIN_ID) as NetworkSlug[]).find((s) => SLUG_CHAIN_ID[s] === chainId) ??
    "mainnet"
  );
}

export function networkLabel(slug: NetworkSlug): string {
  return slug.endsWith("mainnet") ? "Mainnet" : "Testnet";
}

// Groups the explorer's network slugs by chain family, for the family + network
// switcher in the explorer header. Each entry's `label` is the family's display
// name (e.g. "QIE", "BOT Chain").
export const EXPLORER_CHAIN_FAMILIES: Array<{
  label: string;
  testnetSlug: NetworkSlug;
  mainnetSlug?: NetworkSlug;
}> = [
  { label: "QIE", testnetSlug: "testnet", mainnetSlug: "mainnet" },
  { label: "BOT Chain", testnetSlug: "bot-testnet", mainnetSlug: "bot-mainnet" },
];

export function familyForSlug(slug: NetworkSlug) {
  return (
    EXPLORER_CHAIN_FAMILIES.find((f) => f.testnetSlug === slug || f.mainnetSlug === slug) ??
    EXPLORER_CHAIN_FAMILIES[0]
  );
}

// Flattened { slug, label } list for the explorer's single network dropdown,
// e.g. "QIE Testnet", "QIE Mainnet", "BOT Chain Testnet", "BOT Chain Mainnet".
export const EXPLORER_NETWORK_OPTIONS: Array<{ slug: NetworkSlug; label: string }> =
  EXPLORER_CHAIN_FAMILIES.flatMap((f) => [
    { slug: f.testnetSlug, label: `${f.label} ${networkLabel(f.testnetSlug)}` },
    ...(f.mainnetSlug
      ? [{ slug: f.mainnetSlug, label: `${f.label} ${networkLabel(f.mainnetSlug)}` }]
      : []),
  ]);

// Public, shareable base URL for DevStation's own explorer on a given network,
// e.g. https://devstation.online/explorer/mainnet. Used in generated artifacts
// (.env, hackathon submission) so every explorer reference is DevStation's own.
export const DEVSTATION_SITE = "https://devstation.online";
export function devstationExplorerBase(slug: NetworkSlug): string {
  return `${DEVSTATION_SITE}/explorer/${slug}`;
}

// The app's default network, expressed as an explorer slug: QIE mainnet
// (see chains.ts's DEFAULT_CHAIN).
export const DEFAULT_NETWORK_SLUG: NetworkSlug = slugForChainId(DEFAULT_CHAIN.id);

// Reads the active explorer network from the route's $network param. Defaults
// to the app's default network when not inside a network-scoped explorer route.
export function useExplorerNetwork(): NetworkSlug {
  const params = useParams({ strict: false }) as { network?: string };
  return isNetworkSlug(params.network) ? params.network : DEFAULT_NETWORK_SLUG;
}
