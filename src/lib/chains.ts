import { defineChain } from "viem";

// Public env (VITE_*) is readable on both client and server. Falls back to the
// known QIE network values (per docs.qie.digital) so the app works with zero
// configuration.
const TESTNET_RPC = import.meta.env.VITE_QIE_TESTNET_RPC || "https://rpc1testnet.qie.digital/";
const TESTNET_EXPLORER = import.meta.env.VITE_QIE_TESTNET_EXPLORER || "https://testnet.qie.digital";

// QIE Mainnet: chain id 1990, rpc{1..5}mainnet.qie.digital (docs.qie.digital).
const MAINNET_RPC = import.meta.env.VITE_QIE_MAINNET_RPC || "https://rpc1mainnet.qie.digital/";
const MAINNET_EXPLORER = import.meta.env.VITE_QIE_MAINNET_EXPLORER || "https://mainnet.qie.digital";
const MAINNET_CHAIN_ID = Number(import.meta.env.VITE_QIE_MAINNET_CHAIN_ID || 1990);

// QIE DEX swap (used for the "get QIE for gas" link). swap.dex.qie.digital.
export const QIE_DEX_SWAP_URL =
  import.meta.env.VITE_QIE_DEX_URL || "https://www.swap.dex.qie.digital/swap";

export const qieTestnet = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [TESTNET_RPC] } },
  blockExplorers: { default: { name: "QIE Explorer", url: TESTNET_EXPLORER } },
  testnet: true,
});

export const qieMainnet = defineChain({
  id: MAINNET_CHAIN_ID,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [MAINNET_RPC] } },
  blockExplorers: { default: { name: "QIE Explorer", url: MAINNET_EXPLORER } },
  testnet: false,
});

export const SUPPORTED_CHAINS = [qieTestnet, qieMainnet] as const;
export const DEFAULT_CHAIN = qieTestnet;

export const CHAIN_CONFIG = {
  [qieTestnet.id]: {
    rpcUrl: TESTNET_RPC,
    explorerUrl: TESTNET_EXPLORER,
    explorerApiUrl: `${TESTNET_EXPLORER}/api`,
    faucetUrl: "https://qie.digital/faucet",
    name: "QIE Testnet",
  },
  [qieMainnet.id]: {
    rpcUrl: MAINNET_RPC,
    explorerUrl: MAINNET_EXPLORER,
    explorerApiUrl: `${MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "QIE Mainnet",
  },
} as const;

export function chainConfig(chainId: number) {
  return CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG] ?? CHAIN_CONFIG[qieTestnet.id];
}

// Fallback gas price (Gwei) shown before the live RPC value arrives.
export const DEFAULT_GAS_GWEI = 1.2;

// "Get QIE for gas" target, network-aware: testnet → faucet, mainnet → QIE DEX.
export function gasLink(chainId: number): { url: string; label: string } {
  const cfg = chainConfig(chainId);
  return cfg.faucetUrl
    ? { url: cfg.faucetUrl, label: "Get test QIE from Faucet" }
    : { url: QIE_DEX_SWAP_URL, label: "Swap for QIE on QIE DEX" };
}
