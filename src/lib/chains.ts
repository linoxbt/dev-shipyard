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

// BOT Chain (docs.botchain.ai / dev-docs.botchain.ai). Second chain family
// alongside QIE: same shape as the QIE config above.
const BOT_TESTNET_RPC = import.meta.env.VITE_BOT_TESTNET_RPC || "https://rpc.bohr.life";
const BOT_TESTNET_EXPLORER = import.meta.env.VITE_BOT_TESTNET_EXPLORER || "https://scan.bohr.life";
const BOT_TESTNET_CHAIN_ID = Number(import.meta.env.VITE_BOT_TESTNET_CHAIN_ID || 968);

const BOT_MAINNET_RPC = import.meta.env.VITE_BOT_MAINNET_RPC || "https://rpc.botchain.ai";
const BOT_MAINNET_EXPLORER =
  import.meta.env.VITE_BOT_MAINNET_EXPLORER || "https://scan.botchain.ai";
const BOT_MAINNET_CHAIN_ID = Number(import.meta.env.VITE_BOT_MAINNET_CHAIN_ID || 677);

// BOT DEX swap (used for the "get BOT for gas" link on mainnet). dex.botchain.ai.
export const BOT_DEX_SWAP_URL =
  import.meta.env.VITE_BOT_DEX_URL || "https://dex.botchain.ai/#/swap";

export const botTestnet = defineChain({
  id: BOT_TESTNET_CHAIN_ID,
  name: "BOT Chain Testnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [BOT_TESTNET_RPC] } },
  blockExplorers: { default: { name: "BOTScan", url: BOT_TESTNET_EXPLORER } },
  testnet: true,
});

export const botMainnet = defineChain({
  id: BOT_MAINNET_CHAIN_ID,
  name: "BOT Chain Mainnet",
  nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  rpcUrls: { default: { http: [BOT_MAINNET_RPC] } },
  blockExplorers: { default: { name: "BOTScan", url: BOT_MAINNET_EXPLORER } },
  testnet: false,
});

// DevStation is a QIE-first console: QIE leads, BOT Chain is also supported.
// Both run Blockscout, so the explorer, registries and verification work the
// same way on each.
export const SUPPORTED_CHAINS = [qieTestnet, qieMainnet, botTestnet, botMainnet] as const;

export const DEFAULT_CHAIN = qieMainnet;

export const CHAIN_CONFIG = {
  [qieTestnet.id]: {
    rpcUrl: TESTNET_RPC,
    explorerUrl: TESTNET_EXPLORER,
    explorerApiUrl: `${TESTNET_EXPLORER}/api`,
    faucetUrl: "https://qie.digital/faucet",
    name: "QIE Testnet",
    family: "qie",
  },
  [qieMainnet.id]: {
    rpcUrl: MAINNET_RPC,
    explorerUrl: MAINNET_EXPLORER,
    explorerApiUrl: `${MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "QIE Mainnet",
    family: "qie",
  },
  [botTestnet.id]: {
    rpcUrl: BOT_TESTNET_RPC,
    explorerUrl: BOT_TESTNET_EXPLORER,
    explorerApiUrl: `${BOT_TESTNET_EXPLORER}/api`,
    faucetUrl: "https://faucet.botchain.ai/basic",
    name: "BOT Chain Testnet",
    family: "bot",
  },
  [botMainnet.id]: {
    rpcUrl: BOT_MAINNET_RPC,
    explorerUrl: BOT_MAINNET_EXPLORER,
    explorerApiUrl: `${BOT_MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "BOT Chain Mainnet",
    family: "bot",
  },
} as const;

export function chainConfig(chainId: number) {
  return CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG] ?? CHAIN_CONFIG[qieMainnet.id];
}

/** Which chain family a chain id belongs to. Groups a family's testnet and
 *  mainnet together: the primitive behind QIE-native naming (see
 *  src/lib/terminology.ts) and per-family stats. */
export type ChainFamily = (typeof CHAIN_CONFIG)[keyof typeof CHAIN_CONFIG]["family"];

export function chainFamily(chainId: number): ChainFamily | null {
  // Deliberately NOT chainConfig(), which falls back to QIE Mainnet so RPC and
  // explorer lookups always resolve to something usable. That fallback is
  // wrong here: an unmapped chain must report "no family" rather than
  // masquerading as QIE and inheriting QIE-only naming and features.
  const cfg = CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG];
  return cfg ? cfg.family : null;
}

/** True for QIE Testnet and QIE Mainnet. QIE is DevStation's core ecosystem,
 *  so QIE-only features and QIE-native wording gate on this. */
export function isQieChain(chainId: number): boolean {
  return chainFamily(chainId) === "qie";
}

// Fallback gas price (Gwei) shown before the live RPC value arrives.
export const DEFAULT_GAS_GWEI = 1.2;

// Native currency ticker for a chain (e.g. "QIE", "BOT"), read off the viem
// Chain object so unit labels in the UI aren't hardcoded to one chain family.
export function nativeSymbol(chainId: number): string {
  return SUPPORTED_CHAINS.find((c) => c.id === chainId)?.nativeCurrency.symbol ?? "QIE";
}

// Per-family "get gas" DEX link, keyed by mainnet chain id.
const DEX_BY_MAINNET: Record<number, { url: string; name: string }> = {
  [qieMainnet.id]: { url: QIE_DEX_SWAP_URL, name: "QIE DEX" },
  [botMainnet.id]: { url: BOT_DEX_SWAP_URL, name: "BOT DEX" },
};

// "Get <symbol> for gas" target, network-aware: testnet → faucet, mainnet → DEX.
export function gasLink(chainId: number): { url: string; label: string } {
  const cfg = chainConfig(chainId);
  const symbol = nativeSymbol(chainId);
  if (cfg.faucetUrl) return { url: cfg.faucetUrl, label: `Get test ${symbol} from Faucet` };
  // Only mainnet configs reach here (faucetUrl is always set for testnets above).
  const dex = DEX_BY_MAINNET[chainId];
  if (dex) return { url: dex.url, label: `Swap for ${symbol} on ${dex.name}` };
  // No known DEX for this chain family: point at its own explorer rather
  // than guessing a DEX link that might not actually list this token.
  return { url: cfg.explorerUrl, label: `Get ${symbol}` };
}
