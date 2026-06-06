import { useCallback } from "react";
import { useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { DEVSTATION_CONTRACTS, isContractConfigured } from "@/lib/contracts";

export interface OnChainLabel {
  address: string;
  name: string;
  category: string;
  description: string;
  submitter: string;
  submittedAt: number;
  approved: boolean;
  autoLabeled: boolean;
  source: "AUTO" | "COMMUNITY" | "VERIFIED";
}

interface SubmitParams {
  contractAddress: `0x${string}`;
  name: string;
  category: string;
  description: string;
  autoLabeled?: boolean;
}

// On-chain ContractLabelRegistry access. Reads the labeled-contracts list when
// deployed; submitLabel writes a tx. When not deployed, submit is a no-op the
// caller can detect via `onChain`.
export function useContractLabels() {
  const { writeContractAsync } = useWriteContract();
  const registry = DEVSTATION_CONTRACTS.contractLabelRegistry.address;
  const onChain = isContractConfigured(registry);

  const { data: labeledAddresses, refetch } = useReadContract({
    address: registry,
    abi: contractLabelRegistryAbi,
    functionName: "getLabeledContracts",
    query: { enabled: onChain },
  });

  const submitLabel = useCallback(
    async (p: SubmitParams) => {
      if (!onChain) return false;
      await writeContractAsync({
        address: registry,
        abi: contractLabelRegistryAbi,
        functionName: "submitLabel",
        args: [p.contractAddress, p.name, p.category, p.description, p.autoLabeled ?? false],
      });
      refetch();
      return true;
    },
    [onChain, registry, writeContractAsync, refetch],
  );

  return {
    onChain,
    labeledAddresses: (labeledAddresses as readonly string[] | undefined) ?? [],
    submitLabel,
  };
}

// Full on-chain label list (address + struct) for the Label Registry page.
export function useAllLabels(): { labels: OnChainLabel[]; onChain: boolean; refetch: () => void } {
  const registry = DEVSTATION_CONTRACTS.contractLabelRegistry.address;
  const onChain = isContractConfigured(registry);

  const { data: addresses, refetch } = useReadContract({
    address: registry,
    abi: contractLabelRegistryAbi,
    functionName: "getLabeledContracts",
    query: { enabled: onChain },
  });

  const addrList = (addresses as readonly `0x${string}`[] | undefined) ?? [];

  const { data: structs } = useReadContracts({
    contracts: addrList.map((a) => ({
      address: registry,
      abi: contractLabelRegistryAbi,
      functionName: "getLabel" as const,
      args: [a] as const,
    })),
    query: { enabled: onChain && addrList.length > 0 },
  });

  const labels: OnChainLabel[] = addrList.map((address, i) => {
    const r = structs?.[i]?.result as
      | {
          name: string;
          category: string;
          description: string;
          submitter: string;
          submittedAt: bigint;
          approved: boolean;
          autoLabeled: boolean;
        }
      | undefined;
    const source: OnChainLabel["source"] = r?.autoLabeled
      ? "AUTO"
      : r?.approved
        ? "VERIFIED"
        : "COMMUNITY";
    return {
      address,
      name: r?.name ?? "",
      category: r?.category ?? "",
      description: r?.description ?? "",
      submitter: r?.submitter ?? "",
      submittedAt: r ? Number(r.submittedAt) * 1000 : 0,
      approved: r?.approved ?? false,
      autoLabeled: r?.autoLabeled ?? false,
      source,
    };
  });

  return { labels, onChain, refetch };
}

// Single label-name lookup, used by Routebook to resolve on-chain labels.
export function useLabelName(address: string | undefined) {
  const registry = DEVSTATION_CONTRACTS.contractLabelRegistry.address;
  const onChain = isContractConfigured(registry);
  const { data } = useReadContract({
    address: registry,
    abi: contractLabelRegistryAbi,
    functionName: "getLabelName",
    args: address ? [address as `0x${string}`] : undefined,
    query: { enabled: onChain && !!address },
  });
  return (data as string | undefined) || null;
}
