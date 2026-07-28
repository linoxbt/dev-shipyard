// Stacks network registry — the Bitcoin-L2 (Clarity) parallel to
// src/lib/chains.ts / src/lib/solana/chains.ts. Stacks is not EVM: contracts are
// written in Clarity, addresses are c32-encoded (SP.../ST...), and reads go
// through the Hiro API. This module is a self-contained parallel registry; the
// app branches on chain family (src/lib/active-network.ts) to read it.

export type StacksNetworkId = "stacks-mainnet" | "stacks-testnet";

export interface StacksChain {
  id: StacksNetworkId;
  family: "stacks";
  label: "Stacks";
  name: string;
  network: "mainnet" | "testnet";
  /** Hiro API base (extended + v2). */
  apiUrl: string;
  /** Public explorer base (Hiro Explorer). */
  explorerUrl: string;
  /** Explorer ?chain= query suffix that pins the network. */
  explorerChainParam: string;
  nativeSymbol: "STX";
  testnet: boolean;
  faucetUrl: string | null;
}

const MAINNET_API = import.meta.env.VITE_STACKS_MAINNET_API || "https://api.hiro.so";
const TESTNET_API = import.meta.env.VITE_STACKS_TESTNET_API || "https://api.testnet.hiro.so";
const EXPLORER = import.meta.env.VITE_STACKS_EXPLORER || "https://explorer.hiro.so";

export const stacksTestnet: StacksChain = {
  id: "stacks-testnet",
  family: "stacks",
  label: "Stacks",
  name: "Stacks Testnet",
  network: "testnet",
  apiUrl: TESTNET_API,
  explorerUrl: EXPLORER,
  explorerChainParam: "?chain=testnet",
  nativeSymbol: "STX",
  testnet: true,
  faucetUrl: "https://explorer.hiro.so/sandbox/faucet?chain=testnet",
};

export const stacksMainnet: StacksChain = {
  id: "stacks-mainnet",
  family: "stacks",
  label: "Stacks",
  name: "Stacks Mainnet",
  network: "mainnet",
  apiUrl: MAINNET_API,
  explorerUrl: EXPLORER,
  explorerChainParam: "?chain=mainnet",
  nativeSymbol: "STX",
  testnet: false,
  faucetUrl: null,
};

export const STACKS_CHAINS: readonly StacksChain[] = [stacksTestnet, stacksMainnet] as const;
export const DEFAULT_STACKS_NETWORK: StacksNetworkId = "stacks-testnet";

const BY_ID: Record<StacksNetworkId, StacksChain> = {
  "stacks-testnet": stacksTestnet,
  "stacks-mainnet": stacksMainnet,
};

export function isStacksNetwork(v: string | undefined | null): v is StacksNetworkId {
  return v === "stacks-testnet" || v === "stacks-mainnet";
}

export function stacksChain(id: StacksNetworkId): StacksChain {
  return BY_ID[id] ?? stacksTestnet;
}

export function stacksExplorerLink(
  id: StacksNetworkId,
  kind: "txid" | "address",
  value: string,
): string {
  const chain = stacksChain(id);
  return `${chain.explorerUrl}/${kind}/${value}${chain.explorerChainParam}`;
}
