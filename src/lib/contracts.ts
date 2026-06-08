// On-chain contract addresses, read from public env so they can differ per
// deployment without code changes. Empty string = "not deployed yet"; hooks
// that consume these fall back to localStorage / hide UI when an address is absent.
//
// Fill these after running scripts/deploy.ts (testnet first, then mainnet) and
// pasting the addresses into .env.local. See .env.example.

function envAddress(value: string | undefined): `0x${string}` {
  return (value || "") as `0x${string}`;
}

// The DevStation-owned registries.
export const DEVSTATION_CONTRACTS = {
  projectRegistry: { address: envAddress(import.meta.env.VITE_PROJECT_REGISTRY_ADDRESS) },
  contractLabelRegistry: { address: envAddress(import.meta.env.VITE_LABEL_REGISTRY_ADDRESS) },
} as const;

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
