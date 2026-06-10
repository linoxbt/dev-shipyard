import { decodeFunctionData, type Abi } from "viem";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { projectRegistryAddress, labelRegistryAddress } from "@/lib/contracts";

// Known ABIs Routebook can decode against, so a call shows a real method name
// and arguments instead of a raw 4-byte selector. ERC-20/721 cover the vast
// majority of token activity; the DevStation registries cover deploys + labels.
const ERC20_ABI = [
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
    name: "transferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
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
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
] as const;

const ERC721_ABI = [
  {
    type: "function",
    name: "safeTransferFrom",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setApprovalForAll",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }],
    outputs: [],
  },
] as const;

// Common router/multicall/wallet selectors so DeFi and account-abstraction
// calls read as names even without the full ABI.
const COMMON_ABI = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [],
  },
  {
    type: "function",
    name: "execute",
    stateMutability: "payable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  { type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] },
  {
    type: "function",
    name: "withdraw",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "stake",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  { type: "function", name: "claim", stateMutability: "nonpayable", inputs: [], outputs: [] },
] as const;

const KNOWN_ABIS: Abi[] = [
  projectRegistryAbi as unknown as Abi,
  contractLabelRegistryAbi as unknown as Abi,
  ERC20_ABI as unknown as Abi,
  ERC721_ABI as unknown as Abi,
  COMMON_ABI as unknown as Abi,
];

export interface DecodedCall {
  /** Method signature-ish label, e.g. "recordDeployment(address,string,…)". */
  fn: string;
  args: { name: string; type: string; value: string }[];
}

function stringify(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map(stringify).join(", ")}]`;
  if (typeof value === "object")
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return String(value);
}

// Decode an input calldata against the known ABIs. Returns a readable method
// name + named args, or just the raw selector when nothing matches.
export function decodeCalldata(input?: string): DecodedCall {
  if (!input || input === "0x" || input.length < 10) {
    return { fn: input && input !== "0x" ? input.slice(0, 10) : "(native transfer)", args: [] };
  }
  for (const abi of KNOWN_ABIS) {
    try {
      const { functionName, args } = decodeFunctionData({ abi, data: input as `0x${string}` });
      const fnAbi = (abi as Abi).find(
        (e): e is Extract<Abi[number], { type: "function" }> =>
          e.type === "function" && e.name === functionName,
      );
      const inputs = fnAbi?.inputs ?? [];
      const decodedArgs = (args ?? []).map((v, i) => ({
        name: inputs[i]?.name || `arg${i}`,
        type: inputs[i]?.type || "",
        value: stringify(v),
      }));
      const sig = `${functionName}(${inputs.map((p) => p.type).join(",")})`;
      return { fn: sig, args: decodedArgs };
    } catch {
      /* try next ABI */
    }
  }
  return { fn: input.slice(0, 10), args: [] };
}

// Built-in names for the DevStation registries on a given chain, so they never
// read as "unknown" even before the onchain label registry resolves.
export function knownContractName(address: string, chainId: number): string | undefined {
  const a = address.toLowerCase();
  if (a === projectRegistryAddress(chainId).toLowerCase()) return "ProjectRegistry";
  if (a === labelRegistryAddress(chainId).toLowerCase()) return "ContractLabelRegistry";
  return undefined;
}
