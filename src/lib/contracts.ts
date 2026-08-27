// On-chain contract addresses, read from public env so they can differ per
// deployment without code changes. Empty string = "not deployed yet"; hooks
// that consume these fall back to localStorage / hide UI when an address is absent.
//
// Registries are deployed separately on each chain, so the addresses are
// per-network: VITE_*_ADDRESS_TESTNET / _MAINNET. The legacy single
// VITE_*_ADDRESS still works as the testnet fallback. Fill these after running
// scripts/deploy.ts (per network) and pasting the addresses into .env.local.
// See .env.example.

import { qieTestnet, qieMainnet, botTestnet, botMainnet } from "@/lib/chains";

const env = import.meta.env;

// Canonical DevStation registries. The deployer's matching nonces produced
// identical addresses on Testnet (1983) and Mainnet (1990), and both are
// source-verified on the QIE explorer. These are the live defaults so the
// onchain features (Projects, Activity, ecosystem stats) work with zero env
// config; a VITE_*_REGISTRY_ADDRESS_* override still wins for custom deployments.
const DEFAULT_PROJECT_REGISTRY = "0x75d7b39bc827367c409e1a2bf805bd5f337ca27b";
const DEFAULT_LABEL_REGISTRY = "0x177294293e6e785a83e036a95de1697e3cc04748";

function envAddress(value: string | undefined, fallback = ""): `0x${string}` {
  return (value || fallback) as `0x${string}`;
}

// Per-network registry addresses, keyed by chain id. Env overrides the default.
// BOT Chain has no default — its registries are a separate deployment (the QIE
// deployer-nonce coincidence above doesn't carry over to an unrelated chain) —
// so its addresses stay unset until VITE_*_REGISTRY_ADDRESS_BOT_* is configured,
// which is exactly the "not deployed yet" fallback path documented above.
const PROJECT_REGISTRY: Record<number, `0x${string}`> = {
  [qieTestnet.id]: envAddress(
    env.VITE_PROJECT_REGISTRY_ADDRESS_TESTNET || env.VITE_PROJECT_REGISTRY_ADDRESS,
    DEFAULT_PROJECT_REGISTRY,
  ),
  [qieMainnet.id]: envAddress(env.VITE_PROJECT_REGISTRY_ADDRESS_MAINNET, DEFAULT_PROJECT_REGISTRY),
  [botTestnet.id]: envAddress(env.VITE_PROJECT_REGISTRY_ADDRESS_BOT_TESTNET),
  [botMainnet.id]: envAddress(env.VITE_PROJECT_REGISTRY_ADDRESS_BOT_MAINNET),
};

const LABEL_REGISTRY: Record<number, `0x${string}`> = {
  [qieTestnet.id]: envAddress(
    env.VITE_LABEL_REGISTRY_ADDRESS_TESTNET || env.VITE_LABEL_REGISTRY_ADDRESS,
    DEFAULT_LABEL_REGISTRY,
  ),
  [qieMainnet.id]: envAddress(env.VITE_LABEL_REGISTRY_ADDRESS_MAINNET, DEFAULT_LABEL_REGISTRY),
  [botTestnet.id]: envAddress(env.VITE_LABEL_REGISTRY_ADDRESS_BOT_TESTNET),
  [botMainnet.id]: envAddress(env.VITE_LABEL_REGISTRY_ADDRESS_BOT_MAINNET),
};

/** ProjectRegistry address for a given chain ("" when not deployed there). */
export function projectRegistryAddress(chainId: number): `0x${string}` {
  return PROJECT_REGISTRY[chainId] ?? ("" as `0x${string}`);
}

/** ContractLabelRegistry address for a given chain ("" when not deployed there). */
export function labelRegistryAddress(chainId: number): `0x${string}` {
  return LABEL_REGISTRY[chainId] ?? ("" as `0x${string}`);
}

// QIE ecosystem contracts (QIE's own — we do NOT deploy these).
// QUSDC is QIE's USDC-backed stablecoin (docs.stable.qie.digital); its address
// is not published in the docs, so it is env-configurable and the QUSDC balance
// UI hides itself until set.
export const QIE_CONTRACTS = {
  qusdc: { address: envAddress(import.meta.env.VITE_QUSDC_ADDRESS) },
} as const;

export function isContractConfigured(address: `0x${string}`): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Explicit gas limit for registry/label writes. QIE's eth_estimateGas is
// unreliable for storage-writing calls (it returns ~24k for a call that
// actually needs ~275k), which silently runs writes out of gas. These writes
// touch a handful of storage slots; 600k is a safe ceiling and, at QIE's
// few-wei gas price, costs a negligible fraction of a QIE.
export const ONCHAIN_WRITE_GAS = 600_000n;
