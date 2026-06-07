import { useCallback } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import { DEVSTATION_CONTRACTS, isContractConfigured } from "@/lib/contracts";
import { storage, type StoredProject } from "@/lib/storage";

interface RecordParams {
  contractAddress: `0x${string}`;
  templateId: string;
  templateName?: string;
  projectName: string;
  network: string;
  txHash: string;
  chainId: number;
  imageUrl?: string;
  abi?: unknown[];
}

// On-chain ProjectRegistry access. When the registry is deployed (address set),
// reads come from chain and recordDeployment writes a tx; otherwise everything
// falls back to localStorage so the UI keeps working pre-deploy.
export function useProjectRegistry() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const registry = DEVSTATION_CONTRACTS.projectRegistry.address;
  const onChain = isContractConfigured(registry);

  const { data: chainDeployments, refetch } = useReadContract({
    address: registry,
    abi: projectRegistryAbi,
    functionName: "getDeployments",
    args: address ? [address] : undefined,
    query: { enabled: onChain && !!address },
  });

  const recordDeployment = useCallback(
    async (p: RecordParams) => {
      // Always mirror locally for instant UI feedback.
      const local: StoredProject = {
        id: p.txHash,
        name: p.projectName,
        templateId: p.templateId,
        templateName:
          p.templateName ?? (p.templateId === "custom" ? "Custom Solidity" : p.templateId),
        address: p.contractAddress,
        txHash: p.txHash,
        blockNumber: 0,
        deployedAt: Date.now(),
        status: "VERIFIED",
        constructorArgs: {},
        chainId: p.chainId,
        imageUrl: p.imageUrl || undefined,
        abi: p.abi,
      };
      const existing = storage.loadProjects().filter((x) => x.id !== local.id);
      storage.saveProjects([local, ...existing]);

      if (!onChain) return;
      await writeContractAsync({
        address: registry,
        abi: projectRegistryAbi,
        functionName: "recordDeployment",
        args: [p.contractAddress, p.templateId, p.projectName, p.network, p.txHash],
      });
      refetch();
    },
    [onChain, registry, writeContractAsync, refetch],
  );

  // Merge on-chain + local, dedupe by txHash (on-chain wins).
  const onChainList =
    (chainDeployments as
      | ReadonlyArray<{
          contractAddress: string;
          templateId: string;
          projectName: string;
          network: string;
          deployedAt: bigint;
          txHash: string;
        }>
      | undefined) ?? [];
  const merged: StoredProject[] = [];
  const seen = new Set<string>();
  for (const d of onChainList) {
    if (seen.has(d.txHash)) continue;
    seen.add(d.txHash);
    merged.push({
      id: d.txHash,
      name: d.projectName,
      templateId: d.templateId,
      templateName: d.templateId === "custom" ? "Custom Solidity" : d.templateId,
      address: d.contractAddress,
      txHash: d.txHash,
      blockNumber: 0,
      deployedAt: Number(d.deployedAt) * 1000,
      status: "VERIFIED",
      constructorArgs: {},
    });
  }
  for (const l of storage.loadProjects()) {
    if (seen.has(l.id)) continue;
    seen.add(l.id);
    merged.push(l);
  }

  return { deployments: merged, recordDeployment, onChain };
}
