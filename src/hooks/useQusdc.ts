import { useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { qusdcAddress, isContractConfigured } from "@/lib/contracts";

const ERC20_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "symbol",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
] as const;

// Read-only QUSDC (QIE stablecoin) balance for the connected wallet, on the
// selected network. Returns null unless the QUSDC address is configured and the
// wallet is connected — honest reference display, nothing forced.
export function useQusdcBalance(address: `0x${string}` | null | undefined, chainId?: number) {
  // Per-network: QUSDC is a QIE-mainnet asset with no canonical testnet
  // deployment, so this is "" (and the UI hides) everywhere else.
  const token = qusdcAddress(chainId ?? 0);
  const enabled = !!address && isContractConfigured(token);

  const { data: raw } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled },
  });
  const { data: decimals } = useReadContract({
    address: token,
    abi: ERC20_ABI,
    functionName: "decimals",
    chainId,
    query: { enabled },
  });

  if (!enabled || raw === undefined) return null;
  const dec = typeof decimals === "number" ? decimals : 6;
  return { raw: raw as bigint, formatted: Number(formatUnits(raw as bigint, dec)).toFixed(2) };
}
