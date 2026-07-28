// Chain-family discriminator. Lets shared UI (network selectors, explorer
// header, routebook) tell an EVM chain from a Solana cluster without importing
// viem types or the Solana SDK. Purely additive: EVM ids stay numeric, Solana
// ids are the string cluster slugs from src/lib/solana/chains.ts.

import { isSolanaCluster, type SolanaCluster } from "@/lib/solana/chains";

export type ChainFamily = "evm" | "solana";

/** Any id the app can carry: a numeric EVM chain id or a Solana cluster slug. */
export type AnyChainId = number | SolanaCluster;

export function familyOf(id: AnyChainId): ChainFamily {
  return typeof id === "string" && isSolanaCluster(id) ? "solana" : "evm";
}

export function isSolanaId(id: AnyChainId): id is SolanaCluster {
  return familyOf(id) === "solana";
}

/** A slug is a Solana explorer slug when it names a Solana cluster. */
export function isSolanaSlug(slug: string | undefined): slug is SolanaCluster {
  return isSolanaCluster(slug);
}
