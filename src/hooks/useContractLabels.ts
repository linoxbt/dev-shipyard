import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePublicClient, useWriteContract } from "wagmi";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { labelRegistryAddress, isContractConfigured, ONCHAIN_WRITE_GAS } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";
import { getAllLabels } from "@/lib/api/chain.functions";
import { useChainLabel, type ChainLabel } from "@/components/shared/useChainLabel";

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
}

// On-chain ContractLabelRegistry write access. submitLabel writes a tx; when
// the registry isn't deployed on the selected chain, submit is a no-op the
// caller can detect via `onChain`.
export function useContractLabels() {
  const { writeContractAsync } = useWriteContract();
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  const registry = labelRegistryAddress(selectedChainId);
  const onChain = isContractConfigured(registry);
  const client = usePublicClient({ chainId: selectedChainId });

  // Deliberately does NOT call the contract's own getLabeledContracts(): that
  // view returns a single global array with no size cap, so it's a
  // gas-griefing DoS vector for anyone who submits enough unique-address
  // labels (see contracts/ContractLabelRegistry.sol). Nothing in the app
  // consumed this read, so it's dropped entirely rather than made safe: the
  // Label Registry page already sources everything from useAllLabels()
  // (tx-history based, paginated implicitly by the explorer API).
  //
  // Always a community label. The registry only lets its autoLabeler account
  // submit autoLabeled=true, so the same call from a user's wallet reverts:
  // every deploy used to spend gas on a label transaction that could only
  // fail, while the UI reported it as registered.
  //
  // Resolves only once the transaction is mined and succeeded; a revert throws.
  const submitLabel = useCallback(
    async (p: SubmitParams) => {
      if (!onChain) return false;
      // Target the selected chain explicitly so the write can't land on the
      // wrong network, and pin an explicit gas limit (QIE's estimator lowballs
      // storage writes, which would otherwise run out of gas).
      const hash = await writeContractAsync({
        address: registry,
        abi: contractLabelRegistryAbi,
        functionName: "submitLabel",
        args: [p.contractAddress, p.name, p.category, p.description, false],
        chainId: selectedChainId,
        gas: ONCHAIN_WRITE_GAS,
      });
      if (!client) throw new Error("No RPC for this network to confirm the label.");
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
      if (receipt.status !== "success") {
        throw new Error("The label transaction reverted on-chain.");
      }
      return true;
    },
    [client, onChain, registry, writeContractAsync, selectedChainId],
  );

  return { onChain, submitLabel };
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

// Single label lookup, used by Routebook to resolve onchain labels.
// Derived from the full label set (tx-history based) because the registry's
// string-returning view functions revert on QIE (missing MCOPY opcode).
//
// Pass the chain the address belongs to (a transaction's or a URL's chain).
// Without one it falls back to the selected network, which is only right when
// the page itself is about the selected network.
export function useLabel(address: string | undefined, chainId?: number): ChainLabel | null {
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  return useChainLabel(address, chainId ?? selectedChainId);
}

/** The label's name alone. Callers that display it as a contract's name should
 *  use useLabel and check `trusted`: anyone can label any address first. */
export function useLabelName(address: string | undefined, chainId?: number): string | null {
  return useLabel(address, chainId)?.name ?? null;
}
