import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContract, useWriteContract } from "wagmi";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { labelRegistryAddress, isContractConfigured, ONCHAIN_WRITE_GAS } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";
import { getAllLabels } from "@/lib/api/chain.functions";

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
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  const registry = labelRegistryAddress(selectedChainId);
  const onChain = isContractConfigured(registry);

  const { data: labeledAddresses, refetch } = useReadContract({
    address: registry,
    abi: contractLabelRegistryAbi,
    functionName: "getLabeledContracts",
    chainId: selectedChainId,
    query: { enabled: onChain },
  });

  const submitLabel = useCallback(
    async (p: SubmitParams) => {
      if (!onChain) return false;
      // Target the selected chain explicitly so the write can't land on the
      // wrong network, and pin an explicit gas limit (QIE's estimator lowballs
      // storage writes, which would otherwise run out of gas).
      await writeContractAsync({
        address: registry,
        abi: contractLabelRegistryAbi,
        functionName: "submitLabel",
        args: [p.contractAddress, p.name, p.category, p.description, p.autoLabeled ?? false],
        chainId: selectedChainId,
        gas: ONCHAIN_WRITE_GAS,
      });
      refetch();
      return true;
    },
    [onChain, registry, writeContractAsync, refetch, selectedChainId],
  );

  return {
    onChain,
    labeledAddresses: (labeledAddresses as readonly string[] | undefined) ?? [],
    submitLabel,
  };
}

// Full label list for the Label Registry page. Read from the registry's
// submitLabel transaction history (via getAllLabels) rather than contract view
// calls: QIE's EVM lacks the MCOPY opcode (0x5e) that solc 0.8.26 emits for
// string-returning views, so getLabel/batchGetLabels revert on-chain.
export function useAllLabels(opts?: { refetchInterval?: number }): {
  labels: OnChainLabel[];
  onChain: boolean;
  refetch: () => void;
} {
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  const registry = labelRegistryAddress(selectedChainId);
  const onChain = isContractConfigured(registry);

  const { data, refetch } = useQuery({
    queryKey: ["all-labels", selectedChainId, registry],
    queryFn: () => getAllLabels({ data: { chainId: selectedChainId, registry } }),
    enabled: onChain,
    refetchInterval: opts?.refetchInterval,
    staleTime: 15_000,
  });

  const labels: OnChainLabel[] = (data?.labels ?? []).map((l) => ({
    address: l.address,
    name: l.name,
    category: l.category,
    description: "",
    submitter: l.submitter,
    submittedAt: l.timestamp * 1000,
    // Seeded/auto labels are pre-approved; everything else is a community
    // submission awaiting approval (we can't read the approved flag on-chain).
    approved: l.autoLabeled,
    autoLabeled: l.autoLabeled,
    source: l.autoLabeled ? "AUTO" : "COMMUNITY",
  }));

  return { labels, onChain, refetch: () => void refetch() };
}

// Single label-name lookup, used by Routebook to resolve onchain labels.
// Derived from the full label set (tx-history based) because the registry's
// string-returning view functions revert on QIE (missing MCOPY opcode).
export function useLabelName(address: string | undefined) {
  const { labels } = useAllLabels();
  if (!address) return null;
  const a = address.toLowerCase();
  return labels.find((l) => l.address.toLowerCase() === a)?.name ?? null;
}
