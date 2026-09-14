// QIE Mainnet, and the contracts this code reads.
//
// Every value was checked against the live network: chain ID 1990 from the
// RPC, QUSDC's 6 decimals and symbol from the token itself. wallet.js imports
// CHAIN from here, so keep the shape.

import { defineChain } from "viem";

export const CHAIN = {
  id: 1990,
  name: "QIE Mainnet",
  symbol: "QIE",
  rpcUrl: "https://rpc1mainnet.qie.digital/",
  explorerUrl: "https://mainnet.qie.digital",
};

/** For viem clients. */
export const viemChain = defineChain({
  id: CHAIN.id,
  name: CHAIN.name,
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: [CHAIN.rpcUrl] } },
  blockExplorers: { default: { name: "QIE Explorer", url: CHAIN.explorerUrl } },
});

/** QIE's own dollar stablecoin. 6 decimals, not 18. */
export const QUSDC = {
  address: "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5",
  symbol: "QUSDC",
  decimals: 6,
};

/** QIE ID: `.qie` names, an ERC-721. */
export const QIE_ID = "0x9aab56e7727af53A3131985BFB16d845319b7bdc";

/** The ERC-20 calls used here. balanceOf also works on an ERC-721. */
export const ERC20_ABI = [
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
];

/** QIE's eth_estimateGas underestimates writes that touch storage, so token
 *  writes carry an explicit limit. Unused gas is refunded. */
export const TOKEN_WRITE_GAS = 150000n;

export const explorerTx = (hash) => `${CHAIN.explorerUrl}/tx/${hash}`;
export const explorerAddress = (address) => `${CHAIN.explorerUrl}/address/${address}`;
