import { useCallback } from "react";
import { useReadContract, useWriteContract } from "wagmi";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { DEVSTATION_CONTRACTS, isContractConfigured } from "@/lib/contracts";

export interface OnChainLabel {
  address: string;
  name: string;
  category: string;
  source: "AUTO" | "COMMUNITY" | "VERIFIED";
  submitter: string;
  submittedAt: number;
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
