import { useParams } from "@tanstack/react-router";
import {
  qieTestnet,
  qieMainnet,
  botTestnet,
  botMainnet,
  arcTestnet,
  goatTestnet,
  goatMainnet,
  // arbitrumTestnet, arbitrumMainnet, avalancheTestnet, avalancheMainnet,
  // xlayerTestnet, xlayerMainnet — temporarily disabled, see chains.ts's
  // SUPPORTED_CHAINS comment. Re-enable by uncommenting this import and the
  // matching slugs/family entry below.
  DEFAULT_CHAIN,
} from "@/lib/chains";

// The explorer puts the network in the URL (/explorer/testnet, /explorer/mainnet,
// /explorer/bot-testnet, /explorer/bot-mainnet, ...) so a link unambiguously
// refers to one chain. These helpers map between the URL slug and the chain id.
//
// "testnet"/"mainnet" (no prefix) are QIE's original slugs and are never
// renamed — every existing /explorer/testnet and /explorer/mainnet link keeps
// working exactly as before. New chain families get their own prefixed slugs.
//
// Every chain family has an explorer slug. Most are Blockscout-backed
// (confirmed live per chain — see src/lib/chains.ts's comments).
//
// Arbitrum and Avalanche are temporarily commented out throughout this file
// (not deleted) — see chains.ts's SUPPORTED_CHAINS comment. Avalanche's
// official explorer (Snowtrace) is powered by Routescan instead of
// Blockscout — a real, separate data source with its own adapter
// (src/lib/api/routescan.functions.ts) that still works and just needs
// Avalanche re-added to SUPPORTED_CHAINS/here to come back online.
//
// X Layer ("xlayer-testnet"/"xlayer-mainnet") is temporarily commented out
// throughout this file — its explorer (OKLink) requires a registered API key
// we don't have yet, so it only ever had the minimal RPC-only page
// (LimitedExplorer). Re-enable by uncommenting the import above and the
// slugs/family entry below once a key is available.

export type NetworkSlug =
  | "testnet"
  | "mainnet"
  | "bot-testnet"
  | "bot-mainnet"
  | "arc-testnet"
  | "goat-testnet"
  | "goat-mainnet";
// | "arbitrum-testnet" | "arbitrum-mainnet"
// | "avalanche-testnet" | "avalanche-mainnet"
// | "xlayer-testnet" | "xlayer-mainnet" — see note above

const SLUG_CHAIN_ID: Record<NetworkSlug, number> = {
  testnet: qieTestnet.id,
  mainnet: qieMainnet.id,
  "bot-testnet": botTestnet.id,
  "bot-mainnet": botMainnet.id,
  "arc-testnet": arcTestnet.id,
  "goat-testnet": goatTestnet.id,
  "goat-mainnet": goatMainnet.id,
  // "arbitrum-testnet": arbitrumTestnet.id,
  // "arbitrum-mainnet": arbitrumMainnet.id,
  // "avalanche-testnet": avalancheTestnet.id,
  // "avalanche-mainnet": avalancheMainnet.id,
  // "xlayer-testnet": xlayerTestnet.id,
  // "xlayer-mainnet": xlayerMainnet.id,
};

// Chains with no Blockscout/Routescan-style data source yet — the explorer
// shows a minimal RPC-only page (live block height/gas price + a link to the
// chain's real explorer) instead of the full dashboard/tx/block/address UI.
// Currently empty since X Layer (the only chain that needed this) is
// commented out above; re-add "xlayer-testnet"/"xlayer-mainnet" here too
// when X Layer comes back.
const LIMITED_EXPLORER_SLUGS: ReadonlySet<NetworkSlug> = new Set([]);

export function isLimitedExplorerSlug(slug: NetworkSlug): boolean {
  return LIMITED_EXPLORER_SLUGS.has(slug);
}

export function isNetworkSlug(v: string | undefined): v is NetworkSlug {
  return !!v && Object.prototype.hasOwnProperty.call(SLUG_CHAIN_ID, v);
}

export function chainIdForSlug(slug: NetworkSlug): number {
  return SLUG_CHAIN_ID[slug];
}

export function slugForChainId(chainId: number): NetworkSlug {
  return (
    (Object.keys(SLUG_CHAIN_ID) as NetworkSlug[]).find((s) => SLUG_CHAIN_ID[s] === chainId) ??
    "testnet"
  );
}

export function networkLabel(slug: NetworkSlug): string {
  return slug.endsWith("mainnet") ? "Mainnet" : "Testnet";
}

// Groups the explorer's network slugs by chain family, for the family + network
// switcher in the explorer header. Each entry's `label` is the family's display
// name (e.g. "QIE", "BOT Chain"). `mainnetSlug` is omitted for chain families
// with no mainnet yet (e.g. Arc).
export const EXPLORER_CHAIN_FAMILIES: Array<{
  label: string;
  testnetSlug: NetworkSlug;
  mainnetSlug?: NetworkSlug;
}> = [
  { label: "QIE", testnetSlug: "testnet", mainnetSlug: "mainnet" },
  { label: "BOT Chain", testnetSlug: "bot-testnet", mainnetSlug: "bot-mainnet" },
  { label: "Arc", testnetSlug: "arc-testnet" },
  { label: "GOAT Network", testnetSlug: "goat-testnet", mainnetSlug: "goat-mainnet" },
  // { label: "Arbitrum", testnetSlug: "arbitrum-testnet", mainnetSlug: "arbitrum-mainnet" },
  // { label: "Avalanche", testnetSlug: "avalanche-testnet", mainnetSlug: "avalanche-mainnet" },
  // { label: "X Layer", testnetSlug: "xlayer-testnet", mainnetSlug: "xlayer-mainnet" },
];

export function familyForSlug(slug: NetworkSlug) {
  return (
    EXPLORER_CHAIN_FAMILIES.find((f) => f.testnetSlug === slug || f.mainnetSlug === slug) ??
    EXPLORER_CHAIN_FAMILIES[0]
  );
}

// Flattened { slug, label } list for the explorer's single network dropdown,
// e.g. "QIE Testnet", "QIE Mainnet", "BOT Chain Testnet", "BOT Chain Mainnet".
// Families with no mainnet yet (e.g. Arc) only contribute their testnet slug.
export const EXPLORER_NETWORK_OPTIONS: Array<{ slug: NetworkSlug; label: string }> =
  EXPLORER_CHAIN_FAMILIES.flatMap((f) => [
    { slug: f.testnetSlug, label: `${f.label} ${networkLabel(f.testnetSlug)}` },
    ...(f.mainnetSlug
      ? [{ slug: f.mainnetSlug, label: `${f.label} ${networkLabel(f.mainnetSlug)}` }]
      : []),
  ]);

// Public, shareable base URL for DevStation's own explorer on a given network,
// e.g. https://devstation.online/explorer/testnet. Used in generated artifacts
// (.env, hackathon submission) so every explorer reference is DevStation's own.
export const DEVSTATION_SITE = "https://devstation.online";
export function devstationExplorerBase(slug: NetworkSlug): string {
  return `${DEVSTATION_SITE}/explorer/${slug}`;
}

// The app's default network, expressed as an explorer slug — BOT Chain
// mainnet (see chains.ts's DEFAULT_CHAIN).
export const DEFAULT_NETWORK_SLUG: NetworkSlug = slugForChainId(DEFAULT_CHAIN.id);

// Reads the active explorer network from the route's $network param. Defaults
// to the app's default network when not inside a network-scoped explorer route.
export function useExplorerNetwork(): NetworkSlug {
  const params = useParams({ strict: false }) as { network?: string };
  return isNetworkSlug(params.network) ? params.network : DEFAULT_NETWORK_SLUG;
}
