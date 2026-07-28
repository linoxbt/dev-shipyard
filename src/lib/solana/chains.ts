// Solana cluster registry — the non-EVM parallel to src/lib/chains.ts.
//
// Solana is NOT EVM-compatible: there is no numeric chain id, addresses are
// base58 (not 0x), and "contracts" are Rust/Anchor *programs*. So rather than
// forcing Solana into the viem `defineChain`/wagmi world (src/lib/chains.ts),
// this module is a self-contained parallel registry. Shared UI branches on the
// chain *family* (see src/lib/chain-family.ts) to decide which registry to read.
//
// This file is purely additive — it imports nothing from the EVM chain config
// and the EVM config imports nothing from here.

export type SolanaCluster = "solana-devnet" | "solana-mainnet";

export interface SolanaChain {
  /** Stable string id used as the Solana analog of a chain id / explorer slug. */
  id: SolanaCluster;
  family: "solana";
  /** Display name, e.g. "Solana Devnet". */
  name: string;
  /** Short family label used in the explorer header, e.g. "Solana". */
  label: string;
  /** web3.js cluster moniker. */
  cluster: "devnet" | "mainnet-beta";
  rpcUrl: string;
  /** Base URL of the public explorer (Solana Explorer / solscan-style). */
  explorerUrl: string;
  /** URL query suffix that pins the public explorer to this cluster. */
  explorerClusterParam: string;
  nativeSymbol: "SOL";
  /** true for devnet (a test cluster), false for mainnet-beta. */
  testnet: boolean;
  /** Faucet for test SOL, or null on mainnet. */
  faucetUrl: string | null;
}

// Public defaults use Solana's own public RPC endpoints so the app works with
// zero configuration; override via VITE_SOLANA_* for a dedicated RPC provider
// (the public endpoints are heavily rate-limited).
const DEVNET_RPC = import.meta.env.VITE_SOLANA_DEVNET_RPC || "https://api.devnet.solana.com";
const MAINNET_RPC =
  import.meta.env.VITE_SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com";
// The public Solana Explorer works for every cluster via a ?cluster= query.
const EXPLORER_BASE = import.meta.env.VITE_SOLANA_EXPLORER || "https://explorer.solana.com";

export const solanaDevnet: SolanaChain = {
  id: "solana-devnet",
  family: "solana",
  name: "Solana Devnet",
  label: "Solana",
  cluster: "devnet",
  rpcUrl: DEVNET_RPC,
  explorerUrl: EXPLORER_BASE,
  explorerClusterParam: "?cluster=devnet",
  nativeSymbol: "SOL",
  testnet: true,
  faucetUrl: "https://faucet.solana.com",
};

export const solanaMainnet: SolanaChain = {
  id: "solana-mainnet",
  family: "solana",
  name: "Solana Mainnet Beta",
  label: "Solana",
  cluster: "mainnet-beta",
  rpcUrl: MAINNET_RPC,
  explorerUrl: EXPLORER_BASE,
  explorerClusterParam: "",
  nativeSymbol: "SOL",
  testnet: false,
  faucetUrl: null,
};

export const SOLANA_CHAINS: readonly SolanaChain[] = [solanaDevnet, solanaMainnet] as const;

export const DEFAULT_SOLANA_CLUSTER: SolanaCluster = "solana-devnet";

const BY_ID: Record<SolanaCluster, SolanaChain> = {
  "solana-devnet": solanaDevnet,
  "solana-mainnet": solanaMainnet,
};

export function isSolanaCluster(v: string | undefined | null): v is SolanaCluster {
  return v === "solana-devnet" || v === "solana-mainnet";
}

export function solanaChain(id: SolanaCluster): SolanaChain {
  return BY_ID[id] ?? solanaDevnet;
}

/** Public explorer link for an address / tx signature / block on a cluster. */
export function solanaExplorerLink(
  id: SolanaCluster,
  kind: "address" | "tx" | "block",
  value: string,
): string {
  const chain = solanaChain(id);
  return `${chain.explorerUrl}/${kind}/${value}${chain.explorerClusterParam}`;
}

/** "Get SOL" link: devnet → faucet, mainnet → explorer (no DEX guess). */
export function solanaGasLink(id: SolanaCluster): { url: string; label: string } {
  const chain = solanaChain(id);
  if (chain.faucetUrl) return { url: chain.faucetUrl, label: "Get devnet SOL from Faucet" };
  return { url: chain.explorerUrl, label: "Get SOL" };
}
