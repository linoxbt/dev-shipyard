import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import { projectRegistryAddress, isContractConfigured, ONCHAIN_WRITE_GAS } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";
import { getEcosystemStats } from "@/lib/api/chain.functions";
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
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  const registry = projectRegistryAddress(selectedChainId);
  const onChain = isContractConfigured(registry);

  const { data: chainDeployments, refetch } = useReadContract({
    address: registry,
    abi: projectRegistryAbi,
    functionName: "getDeployments",
    args: address ? [address] : undefined,
    chainId: selectedChainId,
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
        deployer: address?.toLowerCase(),
      };
      const existing = storage.loadProjects().filter((x) => x.id !== local.id);
      storage.saveProjects([local, ...existing]);

      if (!onChain) return;
      // Link the deployment to DevStation's onchain ProjectRegistry. Target the
      // deployment's chain explicitly so it can't land on the wrong network, and
      // pin an explicit gas limit: QIE's eth_estimateGas lowballs storage-writing
      // calls (~24k for a call that needs ~275k), which silently ran the write
      // out of gas. The chain's gas price is a few wei, so a high cap is free.
      await writeContractAsync({
        address: registry,
        abi: projectRegistryAbi,
        functionName: "recordDeployment",
        args: [p.contractAddress, p.templateId, p.projectName, p.network, p.txHash],
        chainId: p.chainId ?? selectedChainId,
        gas: ONCHAIN_WRITE_GAS,
      });
      refetch();
    },
    [onChain, registry, writeContractAsync, refetch, selectedChainId, address],
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
  const registeredHashes = new Set<string>();
  for (const d of onChainList) {
    if (registeredHashes.has(d.txHash)) continue;
    registeredHashes.add(d.txHash);
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
    if (registeredHashes.has(l.id)) continue;
    // Per-wallet: require a connected wallet, and only show local deployments
    // made by it. Legacy records (no deployer tag) are shown to whoever is
    // connected, since they predate per-wallet scoping. Onchain entries above
    // are already scoped to `address` by getDeployments.
    if (!address) continue;
    if (l.deployer && l.deployer.toLowerCase() !== address.toLowerCase()) continue;
    merged.push(l);
  }

  // Back-fill: link an existing (local-only) deployment to the onchain registry.
  const registerOnChain = useCallback(
    async (p: {
      contractAddress: string;
      templateId: string;
      projectName: string;
      network: string;
      txHash: string;
      chainId?: number;
    }) => {
      if (!onChain) throw new Error("ProjectRegistry is not configured on this network.");
      await writeContractAsync({
        address: registry,
        abi: projectRegistryAbi,
        functionName: "recordDeployment",
        args: [
          p.contractAddress as `0x${string}`,
          p.templateId,
          p.projectName,
          p.network,
          p.txHash,
        ],
        chainId: p.chainId ?? selectedChainId,
        gas: ONCHAIN_WRITE_GAS,
      });
      refetch();
    },
    [onChain, registry, writeContractAsync, refetch, selectedChainId],
  );

  // Whether a deployment (by txHash) is already linked on-chain.
  const isRegistered = (txHash: string) => registeredHashes.has(txHash);

  return { deployments: merged, recordDeployment, registerOnChain, isRegistered, onChain };
}

// App-wide deployment stats for the Overview, read from the onchain registry:
//  - totalContracts: the ProjectRegistry totalDeployments counter
//  - totalUsers:     distinct wallets that recorded a deployment, counted from
//    the registry's successful recordDeployment txs (see getEcosystemStats).
export function useGlobalDeployStats() {
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  const registry = projectRegistryAddress(selectedChainId);
  const onChain = isContractConfigured(registry);

  const { data } = useQuery({
    queryKey: ["ecosystem-stats", selectedChainId, registry],
    queryFn: () => getEcosystemStats({ data: { chainId: selectedChainId, registry } }),
    enabled: onChain,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  return {
    onChain,
    totalDeployments: data ? data.totalContracts : null,
    uniqueDeployers: data ? data.totalUsers : 0,
  };
}
