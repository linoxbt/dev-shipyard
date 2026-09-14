// QIE chain definitions for viem and wagmi. Values checked against the live
// network: chain IDs from the RPCs, QUSDC's decimals from the token itself.

import { defineChain } from "viem";

export const qieMainnet = defineChain({
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc1mainnet.qie.digital"] },
  },
  blockExplorers: {
    default: {
      name: "QIE Explorer",
      url: "https://mainnet.qie.digital",
      apiUrl: "https://mainnet.qie.digital/api",
    },
  },
});

export const qieTestnet = defineChain({
  id: 1983,
  name: "QIE Testnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: {
    // rpc1testnet has been down for days at a time while the chain kept
    // running; the explorer's own JSON-RPC endpoint is the fallback.
    default: {
      http: ["https://rpc1testnet.qie.digital", "https://testnet.qie.digital/api/eth-rpc"],
    },
  },
  blockExplorers: {
    default: {
      name: "QIE Explorer",
      url: "https://testnet.qie.digital",
      apiUrl: "https://testnet.qie.digital/api",
    },
  },
  testnet: true,
});

/** QUSDC on QIE Mainnet. 6 decimals, not 18. */
export const QUSDC = {
  address: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  symbol: "QUSDC",
  decimals: 6,
} as const;

/** QIE ID (.qie names) on QIE Mainnet, an ERC-721. */
export const QIE_ID = "0x9aab56e7727af53A3131985BFB16d845319b7bdc" as const;

/** The registrar's register(Order order, bool isFree). */
export const QIE_ID_REGISTER_SELECTOR = "0xbc96db3f" as const;

/** Parameters for wallet_addEthereumChain. */
export function addChainParams(chain: typeof qieMainnet | typeof qieTestnet) {
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
    blockExplorerUrls: [chain.blockExplorers.default.url],
  };
}

/* wagmi, for example:

import { createConfig, fallback, http } from "wagmi";
import { injected } from "wagmi/connectors";

export const config = createConfig({
  chains: [qieMainnet, qieTestnet],
  connectors: [injected()],
  transports: {
    [qieMainnet.id]: http(),
    [qieTestnet.id]: fallback(qieTestnet.rpcUrls.default.http.map((url) => http(url))),
  },
});
*/
