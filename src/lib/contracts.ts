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
// Per-NETWORK defaults. These were previously a single pair reused for both
// QIE networks, which meant an unset (or wrongly-set) mainnet var silently
// fell back to the *testnet* registry address — reads would hit a contract
// that exists but holds the wrong network's data, with no error anywhere.
// Keeping them separate makes that impossible.
const QIE_TESTNET_PROJECT_REGISTRY = "0x75d7b39bc827367c409e1a2bf805bd5f337ca27b";
const QIE_TESTNET_LABEL_REGISTRY = "0x177294293e6e785a83e036a95de1697e3cc04748";
const QIE_MAINNET_PROJECT_REGISTRY = "0x673e3d4d7f6043d0384e95ce0c110f09e09ec708";
const QIE_MAINNET_LABEL_REGISTRY = "0xb6075e4cad1f7e7e779e49dcf7df08949797ed81";

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
    QIE_TESTNET_PROJECT_REGISTRY,
  ),
  [qieMainnet.id]: envAddress(
    env.VITE_PROJECT_REGISTRY_ADDRESS_MAINNET,
    QIE_MAINNET_PROJECT_REGISTRY,
  ),
  [botTestnet.id]: envAddress(env.VITE_PROJECT_REGISTRY_ADDRESS_BOT_TESTNET),
  [botMainnet.id]: envAddress(env.VITE_PROJECT_REGISTRY_ADDRESS_BOT_MAINNET),
};

const LABEL_REGISTRY: Record<number, `0x${string}`> = {
  [qieTestnet.id]: envAddress(
    env.VITE_LABEL_REGISTRY_ADDRESS_TESTNET || env.VITE_LABEL_REGISTRY_ADDRESS,
    QIE_TESTNET_LABEL_REGISTRY,
  ),
  [qieMainnet.id]: envAddress(env.VITE_LABEL_REGISTRY_ADDRESS_MAINNET, QIE_MAINNET_LABEL_REGISTRY),
  [botTestnet.id]: envAddress(env.VITE_LABEL_REGISTRY_ADDRESS_BOT_TESTNET),
  [botMainnet.id]: envAddress(env.VITE_LABEL_REGISTRY_ADDRESS_BOT_MAINNET),
};

const TEMPLATE_REGISTRY: Record<number, `0x${string}`> = {
  [qieTestnet.id]: envAddress(env.VITE_TEMPLATE_REGISTRY_ADDRESS_TESTNET),
  [qieMainnet.id]: envAddress(env.VITE_TEMPLATE_REGISTRY_ADDRESS_MAINNET),
  [botTestnet.id]: envAddress(env.VITE_TEMPLATE_REGISTRY_ADDRESS_BOT_TESTNET),
  [botMainnet.id]: envAddress(env.VITE_TEMPLATE_REGISTRY_ADDRESS_BOT_MAINNET),
};

/** TemplateRegistry address for a given chain ("" when not deployed there).
 *
 *  No hardcoded fallback, unlike the two registries above: this one is not
 *  deployed anywhere yet, and baking in an address before it exists would
 *  point the marketplace at nothing and report it as configured. */
export function templateRegistryAddress(chainId: number): `0x${string}` {
  return TEMPLATE_REGISTRY[chainId] ?? ("" as `0x${string}`);
}

/** ProjectRegistry address for a given chain ("" when not deployed there). */
export function projectRegistryAddress(chainId: number): `0x${string}` {
  return PROJECT_REGISTRY[chainId] ?? ("" as `0x${string}`);
}

/** ContractLabelRegistry address for a given chain ("" when not deployed there). */
export function labelRegistryAddress(chainId: number): `0x${string}` {
  return LABEL_REGISTRY[chainId] ?? ("" as `0x${string}`);
}

// QIE ecosystem contracts (QIE's own — we do NOT deploy these).
//
// QUSDC is QIE's USDC-backed stablecoin. docs.stable.qie.digital is entirely
// conceptual and publishes no address, so this was verified directly against
// mainnet: 0x3F43…5DA5 has 6096 bytes of code, symbol/name "QUSDC", and
// decimals() == 6 (NOT 18 — anything formatting it must read decimals()).
//
// Deliberately per-network, because QUSDC is NOT deployed at a matching
// address on testnet. A single global address would make QIE Testnet read a
// contract that isn't there and silently render a 0 balance. QIE testnet has
// 10+ competing unofficial "QUSDC" contracts with no canonical one (and one
// of them uses 18 decimals), so testnet stays unset until QIE publishes an
// official address — the balance UI hides itself when unconfigured.
const QIE_MAINNET_QUSDC = "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5";

const QUSDC: Record<number, `0x${string}`> = {
  [qieTestnet.id]: envAddress(env.VITE_QUSDC_ADDRESS_TESTNET),
  [qieMainnet.id]: envAddress(
    env.VITE_QUSDC_ADDRESS_MAINNET || env.VITE_QUSDC_ADDRESS,
    QIE_MAINNET_QUSDC,
  ),
};

/** QUSDC address for a given chain ("" where QIE's stablecoin isn't deployed). */
export function qusdcAddress(chainId: number): `0x${string}` {
  return QUSDC[chainId] ?? ("" as `0x${string}`);
}

// QIE ID — the ".qie" name registry. Despite the "ID" branding this is a
// plain ERC-721 of domain names, NOT an identity resolver: verified on
// mainnet, supportsInterface(0x80ac58cd) returns true, 12,175 minted, and
// balanceOf(holder) works. What does NOT work, and must not be built on:
// ownerOf(1) reverts (token ids are not sequential), tokenURI is empty, and
// the ENS-style addr()/name() resolver calls revert. So the only sound check
// is "does this address hold at least one .qie name" via balanceOf.
// Mainnet-only, like QUSDC — there is no published testnet deployment.
const QIE_MAINNET_QIE_ID = "0x9aab56e7727af53A3131985BFB16d845319b7bdc";

const QIE_ID: Record<number, `0x${string}`> = {
  [qieTestnet.id]: envAddress(env.VITE_QIE_ID_ADDRESS_TESTNET),
  [qieMainnet.id]: envAddress(env.VITE_QIE_ID_ADDRESS_MAINNET, QIE_MAINNET_QIE_ID),
};

/** QIE ID (.qie names) ERC-721 for a chain ("" where it isn't deployed). */
export function qieIdAddress(chainId: number): `0x${string}` {
  return QIE_ID[chainId] ?? ("" as `0x${string}`);
}

export function isContractConfigured(address: `0x${string}`): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

// Explicit gas limit for registry/label writes. QIE's eth_estimateGas is
// unreliable for storage-writing calls (it returns ~24k for a call that
// actually needs ~275k), which silently runs writes out of gas. These writes
// touch a handful of storage slots; 600k is a safe ceiling and, at QIE's
// few-wei gas price, costs a negligible fraction of a QIE.
export const ONCHAIN_WRITE_GAS = 600_000n;
