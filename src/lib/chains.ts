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
// added alongside QIE — same shape as the QIE config above, purely additive.
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

// X Layer (OKX's L2, docs at web3.okx.com/xlayer/docs). Runs OKLink as its
// explorer, not Blockscout — see CHAIN_CONFIG below and network.ts for what
// that means for internal explorer support.
const XLAYER_TESTNET_RPC =
  import.meta.env.VITE_XLAYER_TESTNET_RPC || "https://testrpc.xlayer.tech/terigon";
const XLAYER_TESTNET_EXPLORER =
  import.meta.env.VITE_XLAYER_TESTNET_EXPLORER || "https://www.oklink.com/xlayer-testnet";
const XLAYER_TESTNET_CHAIN_ID = Number(import.meta.env.VITE_XLAYER_TESTNET_CHAIN_ID || 1952);

const XLAYER_MAINNET_RPC = import.meta.env.VITE_XLAYER_MAINNET_RPC || "https://rpc.xlayer.tech";
const XLAYER_MAINNET_EXPLORER =
  import.meta.env.VITE_XLAYER_MAINNET_EXPLORER || "https://www.oklink.com/xlayer";
const XLAYER_MAINNET_CHAIN_ID = Number(import.meta.env.VITE_XLAYER_MAINNET_CHAIN_ID || 196);

export const xlayerTestnet = defineChain({
  id: XLAYER_TESTNET_CHAIN_ID,
  name: "X Layer Testnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_TESTNET_RPC] } },
  blockExplorers: { default: { name: "OKLink", url: XLAYER_TESTNET_EXPLORER } },
  testnet: true,
});

export const xlayerMainnet = defineChain({
  id: XLAYER_MAINNET_CHAIN_ID,
  name: "X Layer Mainnet",
  nativeCurrency: { name: "OKB", symbol: "OKB", decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_MAINNET_RPC] } },
  blockExplorers: { default: { name: "OKLink", url: XLAYER_MAINNET_EXPLORER } },
  testnet: false,
});

// Arc (Circle's stablecoin-native L1, docs.arc.io). Testnet only — no
// mainnet exists yet. Runs Blockscout (ArcScan).
const ARC_TESTNET_RPC = import.meta.env.VITE_ARC_TESTNET_RPC || "https://rpc.testnet.arc.network";
const ARC_TESTNET_EXPLORER =
  import.meta.env.VITE_ARC_TESTNET_EXPLORER || "https://testnet.arcscan.app";
const ARC_TESTNET_CHAIN_ID = Number(import.meta.env.VITE_ARC_TESTNET_CHAIN_ID || 5042002);

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_TESTNET_RPC] } },
  blockExplorers: { default: { name: "ArcScan", url: ARC_TESTNET_EXPLORER } },
  testnet: true,
});

// Avalanche (avax.network). Runs Snowtrace/Routescan as its explorer, not
// Blockscout — see CHAIN_CONFIG below and network.ts for what that means.
// Testnet RPC default is publicnode's mirror, not Avalanche's own
// api.avax-test.network — the official endpoint sits behind Cloudflare bot
// protection that 403s server-side requests (confirmed: every RPC call from
// this app's server functions, e.g. eth_getTransactionByHash, got a
// Cloudflare "Attention Required" HTML page instead of JSON). publicnode's
// mirror serves the same live Fuji testnet data without that block.
const AVALANCHE_TESTNET_RPC =
  import.meta.env.VITE_AVALANCHE_TESTNET_RPC || "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const AVALANCHE_TESTNET_EXPLORER =
  import.meta.env.VITE_AVALANCHE_TESTNET_EXPLORER || "https://testnet.snowtrace.io";
const AVALANCHE_TESTNET_CHAIN_ID = Number(import.meta.env.VITE_AVALANCHE_TESTNET_CHAIN_ID || 43113);

const AVALANCHE_MAINNET_RPC =
  import.meta.env.VITE_AVALANCHE_MAINNET_RPC || "https://api.avax.network/ext/bc/C/rpc";
const AVALANCHE_MAINNET_EXPLORER =
  import.meta.env.VITE_AVALANCHE_MAINNET_EXPLORER || "https://snowtrace.io";
const AVALANCHE_MAINNET_CHAIN_ID = Number(import.meta.env.VITE_AVALANCHE_MAINNET_CHAIN_ID || 43114);

export const avalancheTestnet = defineChain({
  id: AVALANCHE_TESTNET_CHAIN_ID,
  name: "Avalanche Fuji Testnet",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [AVALANCHE_TESTNET_RPC] } },
  blockExplorers: { default: { name: "Snowtrace", url: AVALANCHE_TESTNET_EXPLORER } },
  testnet: true,
});

export const avalancheMainnet = defineChain({
  id: AVALANCHE_MAINNET_CHAIN_ID,
  name: "Avalanche C-Chain",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [AVALANCHE_MAINNET_RPC] } },
  blockExplorers: { default: { name: "Snowtrace", url: AVALANCHE_MAINNET_EXPLORER } },
  testnet: false,
});

// GOAT Network (Bitcoin L2, docs.goat.network). Gas token is BTC. Runs
// Blockscout.
const GOAT_TESTNET_RPC =
  import.meta.env.VITE_GOAT_TESTNET_RPC || "https://rpc.testnet3.goat.network";
const GOAT_TESTNET_EXPLORER =
  import.meta.env.VITE_GOAT_TESTNET_EXPLORER || "https://explorer.testnet3.goat.network";
const GOAT_TESTNET_CHAIN_ID = Number(import.meta.env.VITE_GOAT_TESTNET_CHAIN_ID || 48816);

const GOAT_MAINNET_RPC = import.meta.env.VITE_GOAT_MAINNET_RPC || "https://rpc.goat.network";
const GOAT_MAINNET_EXPLORER =
  import.meta.env.VITE_GOAT_MAINNET_EXPLORER || "https://explorer.goat.network";
const GOAT_MAINNET_CHAIN_ID = Number(import.meta.env.VITE_GOAT_MAINNET_CHAIN_ID || 2345);

export const goatTestnet = defineChain({
  id: GOAT_TESTNET_CHAIN_ID,
  name: "GOAT Network Testnet3",
  nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [GOAT_TESTNET_RPC] } },
  blockExplorers: { default: { name: "GOAT Explorer", url: GOAT_TESTNET_EXPLORER } },
  testnet: true,
});

export const goatMainnet = defineChain({
  id: GOAT_MAINNET_CHAIN_ID,
  name: "GOAT Network",
  nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [GOAT_MAINNET_RPC] } },
  blockExplorers: { default: { name: "GOAT Explorer", url: GOAT_MAINNET_EXPLORER } },
  testnet: false,
});

// Arbitrum. Gas is paid in ETH (ARB is a separate governance-only token, not
// used for gas). Official explorer is Arbiscan (Etherscan-family); we use
// the community Blockscout mirror instead so DevStation's own explorer
// dashboard works the same way it does for every other chain here.
const ARBITRUM_TESTNET_RPC =
  import.meta.env.VITE_ARBITRUM_TESTNET_RPC || "https://sepolia-rollup.arbitrum.io/rpc";
const ARBITRUM_TESTNET_EXPLORER =
  import.meta.env.VITE_ARBITRUM_TESTNET_EXPLORER || "https://arbitrum-sepolia.blockscout.com";
const ARBITRUM_TESTNET_CHAIN_ID = Number(import.meta.env.VITE_ARBITRUM_TESTNET_CHAIN_ID || 421614);

const ARBITRUM_MAINNET_RPC =
  import.meta.env.VITE_ARBITRUM_MAINNET_RPC || "https://arb1.arbitrum.io/rpc";
const ARBITRUM_MAINNET_EXPLORER =
  import.meta.env.VITE_ARBITRUM_MAINNET_EXPLORER || "https://arbitrum.blockscout.com";
const ARBITRUM_MAINNET_CHAIN_ID = Number(import.meta.env.VITE_ARBITRUM_MAINNET_CHAIN_ID || 42161);

export const arbitrumTestnet = defineChain({
  id: ARBITRUM_TESTNET_CHAIN_ID,
  name: "Arbitrum Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ARBITRUM_TESTNET_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: ARBITRUM_TESTNET_EXPLORER } },
  testnet: true,
});

export const arbitrumMainnet = defineChain({
  id: ARBITRUM_MAINNET_CHAIN_ID,
  name: "Arbitrum One",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ARBITRUM_MAINNET_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: ARBITRUM_MAINNET_EXPLORER } },
  testnet: false,
});

export const SUPPORTED_CHAINS = [
  qieTestnet,
  qieMainnet,
  botTestnet,
  botMainnet,
  // xlayerTestnet, xlayerMainnet — temporarily disabled. X Layer's explorer
  // (OKLink) needs a registered API key DevStation doesn't have yet, so it
  // only ever got the minimal RPC-only explorer page; commented out here
  // (not deleted) until that key is available. Re-enable by uncommenting
  // these two plus the matching entries in explorer/network.ts.
  arcTestnet,
  avalancheTestnet,
  avalancheMainnet,
  goatTestnet,
  goatMainnet,
  arbitrumTestnet,
  arbitrumMainnet,
] as const;
export const DEFAULT_CHAIN = botMainnet;

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
  [botTestnet.id]: {
    rpcUrl: BOT_TESTNET_RPC,
    explorerUrl: BOT_TESTNET_EXPLORER,
    explorerApiUrl: `${BOT_TESTNET_EXPLORER}/api`,
    faucetUrl: "https://faucet.botchain.ai/basic",
    name: "BOT Chain Testnet",
  },
  [botMainnet.id]: {
    rpcUrl: BOT_MAINNET_RPC,
    explorerUrl: BOT_MAINNET_EXPLORER,
    explorerApiUrl: `${BOT_MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "BOT Chain Mainnet",
  },
  [xlayerTestnet.id]: {
    rpcUrl: XLAYER_TESTNET_RPC,
    explorerUrl: XLAYER_TESTNET_EXPLORER,
    explorerApiUrl: `${XLAYER_TESTNET_EXPLORER}/api`,
    faucetUrl: "https://web3.okx.com/xlayer/faucet",
    name: "X Layer Testnet",
  },
  [xlayerMainnet.id]: {
    rpcUrl: XLAYER_MAINNET_RPC,
    explorerUrl: XLAYER_MAINNET_EXPLORER,
    explorerApiUrl: `${XLAYER_MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "X Layer Mainnet",
  },
  [arcTestnet.id]: {
    rpcUrl: ARC_TESTNET_RPC,
    explorerUrl: ARC_TESTNET_EXPLORER,
    explorerApiUrl: `${ARC_TESTNET_EXPLORER}/api`,
    faucetUrl: "https://faucet.circle.com",
    name: "Arc Testnet",
  },
  [avalancheTestnet.id]: {
    rpcUrl: AVALANCHE_TESTNET_RPC,
    explorerUrl: AVALANCHE_TESTNET_EXPLORER,
    explorerApiUrl: `${AVALANCHE_TESTNET_EXPLORER}/api`,
    faucetUrl: "https://core.app/tools/testnet-faucet/?subnet=c&token=c",
    name: "Avalanche Fuji Testnet",
  },
  [avalancheMainnet.id]: {
    rpcUrl: AVALANCHE_MAINNET_RPC,
    explorerUrl: AVALANCHE_MAINNET_EXPLORER,
    explorerApiUrl: `${AVALANCHE_MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "Avalanche C-Chain",
  },
  [goatTestnet.id]: {
    rpcUrl: GOAT_TESTNET_RPC,
    explorerUrl: GOAT_TESTNET_EXPLORER,
    explorerApiUrl: `${GOAT_TESTNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "GOAT Network Testnet3",
  },
  [goatMainnet.id]: {
    rpcUrl: GOAT_MAINNET_RPC,
    explorerUrl: GOAT_MAINNET_EXPLORER,
    explorerApiUrl: `${GOAT_MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "GOAT Network",
  },
  [arbitrumTestnet.id]: {
    rpcUrl: ARBITRUM_TESTNET_RPC,
    explorerUrl: ARBITRUM_TESTNET_EXPLORER,
    explorerApiUrl: `${ARBITRUM_TESTNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "Arbitrum Sepolia",
  },
  [arbitrumMainnet.id]: {
    rpcUrl: ARBITRUM_MAINNET_RPC,
    explorerUrl: ARBITRUM_MAINNET_EXPLORER,
    explorerApiUrl: `${ARBITRUM_MAINNET_EXPLORER}/api`,
    faucetUrl: null,
    name: "Arbitrum One",
  },
} as const;

export function chainConfig(chainId: number) {
  return CHAIN_CONFIG[chainId as keyof typeof CHAIN_CONFIG] ?? CHAIN_CONFIG[qieTestnet.id];
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
  // No known DEX for this chain family — point at its own explorer rather
  // than guessing a DEX link that might not actually list this token.
  return { url: cfg.explorerUrl, label: `Get ${symbol}` };
}
