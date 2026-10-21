import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import { projectRegistryAddress, isContractConfigured, ONCHAIN_WRITE_GAS } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";
import { getCombinedEcosystemStats } from "@/lib/api/chain.functions";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { storage, type StoredProject } from "@/lib/storage";
import { useProjects } from "@/lib/data/projects";
import { getVerificationStatus } from "@/lib/api/verify.functions";

export type ProjectStatus = StoredProject["status"];

/**
 * Persist the project list and confirm it actually landed.
 *
 * localStorage throws once it is full, and the storage layer swallows that, so
 * a deploy record could vanish with nobody told. Each record can carry a full
 * standard-JSON compiler input (100 KB+ with OpenZeppelin sources), which is
 * what fills it. So: write, read back, and if the newest record is missing,
 * retry with the compiler inputs dropped from every record but the newest, and
 * then from all of them. Only if that still fails is the user told.
 */
export function saveProjectsChecked(projects: StoredProject[]): boolean {
  // Did exactly this list land? Comparing ids and statuses, not just "is the
  // newest id there": a status change to an existing record would otherwise
  // read as saved when the write failed and the old list is still in place.
  const landed = (written: StoredProject[]) => {
    const back = storage.loadProjects();
    return (
      back.length === written.length &&
      written.every((p, i) => back[i]?.id === p.id && back[i]?.status === p.status)
    );
  };
  storage.saveProjects(projects);
  if (landed(projects)) return true;
  const lean = projects.map((x, i) => (i === 0 ? x : { ...x, standardJsonInput: undefined }));
  storage.saveProjects(lean);
  if (landed(lean)) return true;
  const leanest = lean.map((x) => ({ ...x, standardJsonInput: undefined }));
  storage.saveProjects(leanest);
  if (landed(leanest)) {
    toast.warning(
      "Browser storage is full, so this deploy was saved without its compiler input. " +
        "You can still verify it by pasting the source.",
    );
    return true;
  }
  toast.error(
    "Browser storage is full: this deployment could not be saved locally. " +
      "It is still on-chain; note its address.",
  );
  return false;
}

/**
 * Record what the explorer says about a deployment's source verification.
 *
 * Nothing is "VERIFIED" until the explorer says so. Once it does, the stored
 * compiler input has done its job and is dropped, which is most of the space a
 * record takes.
 */
export function markProjectStatus(
  address: string,
  chainId: number | undefined,
  status: ProjectStatus,
) {
  const a = address.toLowerCase();
  const match = (x: StoredProject) =>
    x.address.toLowerCase() === a && (chainId === undefined || !x.chainId || x.chainId === chainId);
  const stored = storage.loadProjects();
  if (!stored.some(match)) return;
  const next = stored.map((x) =>
    match(x)
      ? {
          ...x,
          status,
          standardJsonInput: status === "VERIFIED" ? undefined : x.standardJsonInput,
        }
      : x,
  );
  saveProjectsChecked(next);
  // Keep the in-memory store the Projects page renders from in step.
  const store = useProjects.getState();
  if (store.hydrated) {
    useProjects.setState({
      projects: store.projects.map((x) =>
        x.address.toLowerCase() === a &&
        (chainId === undefined || !x.chainId || x.chainId === chainId)
          ? {
              ...x,
              status,
              standardJsonInput: status === "VERIFIED" ? undefined : x.standardJsonInput,
            }
          : x,
      ),
    });
  }
}

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
  // Source-verification metadata, persisted so Projects can (re)verify later.
  standardJsonInput?: string;
  qualifiedName?: string;
  compilerVersion?: string;
  constructorArgsEncoded?: string;
}

// On-chain ProjectRegistry access. When the registry is deployed (address set),
// reads come from chain and recordDeployment writes a tx; otherwise everything
// falls back to localStorage so the UI keeps working pre-deploy.
export function useProjectRegistry() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const wagmiConfig = useConfig();
  const selectedChainId = useNetworkPref((s) => s.preferredChainId);
  const registry = projectRegistryAddress(selectedChainId);
  const onChain = isContractConfigured(registry);
  // Bumped after every local write so the merged list below re-reads storage
  // only when it changed, not on every render of every consumer.
  const [localVersion, setLocalVersion] = useState(0);

  /** Send recordDeployment to the registry ON THE DEPLOYMENT'S CHAIN, and
   *  resolve only once it is mined and succeeded. */
  const writeRecord = useCallback(
    async (
      chainId: number,
      args: readonly [`0x${string}`, string, string, string, string],
    ): Promise<void> => {
      const target = projectRegistryAddress(chainId);
      if (!isContractConfigured(target)) {
        throw new Error("ProjectRegistry is not configured on this network.");
      }
      const hash = await writeContractAsync({
        address: target,
        abi: projectRegistryAbi,
        functionName: "recordDeployment",
        args,
        chainId,
        gas: ONCHAIN_WRITE_GAS,
      });
      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        hash,
        chainId,
        timeout: 120_000,
      });
      if (receipt.status !== "success") {
        throw new Error("The registry transaction reverted on-chain.");
      }
    },
    [wagmiConfig, writeContractAsync],
  );

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
        // Not verified until the explorer says it is: see markProjectStatus.
        status: "PENDING",
        constructorArgs: {},
        chainId: p.chainId,
        imageUrl: p.imageUrl || undefined,
        abi: p.abi,
        deployer: address?.toLowerCase(),
        standardJsonInput: p.standardJsonInput,
        qualifiedName: p.qualifiedName,
        compilerVersion: p.compilerVersion,
        constructorArgsEncoded: p.constructorArgsEncoded,
      };
      const existing = storage.loadProjects().filter((x) => x.id !== local.id);
      saveProjectsChecked([local, ...existing]);
      setLocalVersion((v) => v + 1);

      if (!isContractConfigured(projectRegistryAddress(p.chainId))) return;
      // Link the deployment to DevStation's onchain ProjectRegistry, on the
      // deployment's own chain (its registry, not the selected chain's), with
      // an explicit gas limit: QIE's eth_estimateGas lowballs storage-writing
      // calls (~24k for a call that needs ~275k), which silently ran the write
      // out of gas. The chain's gas price is a few wei, so a high cap is free.
      await writeRecord(p.chainId, [
        p.contractAddress,
        p.templateId,
        p.projectName,
        p.network,
        p.txHash,
      ]);
      refetch();
    },
    [writeRecord, refetch, address],
  );

  // Merge on-chain + local, dedupe by txHash (on-chain wins).
  const { merged, registeredHashes } = useMemo(() => {
    void localVersion;
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
    const local = storage.loadProjects();
    const localByHash = new Map(local.map((l) => [l.id, l]));
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
        // The registry records that a deploy happened, not whether its source
        // is verified: take what this browser learned from the explorer.
        status: localByHash.get(d.txHash)?.status ?? "PENDING",
        constructorArgs: {},
        chainId: localByHash.get(d.txHash)?.chainId ?? selectedChainId,
      });
    }
    for (const l of local) {
      if (registeredHashes.has(l.id)) continue;
      // Per-wallet: require a connected wallet, and only show local deployments
      // made by it. Legacy records (no deployer tag) are shown to whoever is
      // connected, since they predate per-wallet scoping. Onchain entries above
      // are already scoped to `address` by getDeployments.
      if (!address) continue;
      if (l.deployer && l.deployer.toLowerCase() !== address.toLowerCase()) continue;
      merged.push(l);
    }
    return { merged, registeredHashes };
  }, [chainDeployments, address, localVersion, selectedChainId]);

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
      await writeRecord(p.chainId ?? selectedChainId, [
        p.contractAddress as `0x${string}`,
        p.templateId,
        p.projectName,
        p.network,
        p.txHash,
      ]);
      refetch();
    },
    [writeRecord, refetch, selectedChainId],
  );

  // What the explorer says about each deployment's source. Records made before
  // this were all stamped VERIFIED regardless, and a fresh deploy starts
  // PENDING, so the explorer is asked once per deployment (cached for ten
  // minutes) and storage follows the answer.
  const toCheck = merged.filter((m) => m.chainId).slice(0, 25);
  useQuery({
    queryKey: [
      "project-verification",
      toCheck.map((m) => `${m.chainId}:${m.address.toLowerCase()}:${m.status}`).join(","),
    ],
    enabled: toCheck.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      let changed = false;
      for (const m of toCheck) {
        const res = await getVerificationStatus({
          data: { chainId: m.chainId!, address: m.address as `0x${string}` },
        }).catch(() => null);
        if (!res || !res.found) continue;
        const truth: ProjectStatus = res.verified ? "VERIFIED" : "PENDING";
        if (truth !== m.status) {
          markProjectStatus(m.address, m.chainId, truth);
          changed = true;
        }
      }
      if (changed) setLocalVersion((v) => v + 1);
      return changed;
    },
  });

  // Whether a deployment (by txHash) is already linked on-chain.
  const isRegistered = (txHash: string) => registeredHashes.has(txHash);

  return { deployments: merged, recordDeployment, registerOnChain, isRegistered, onChain };
}

// Universal ecosystem stats across every supported chain combined: total
// contracts is the sum of each chain's counter; total users is the union of
// deployer wallets (a wallet active on multiple chains counts once). Used by
// the Overview, Activity, and landing page so they show one ecosystem-wide
// figure rather than a per-chain number. Chains with no configured registry
// are dropped; if none are configured, onChain is false and the UI falls back.
export function useCombinedDeployStats() {
  const chains = SUPPORTED_CHAINS.map((c) => c.id)
    .map((chainId) => ({ chainId, registry: projectRegistryAddress(chainId) }))
    .filter((c) => isContractConfigured(c.registry));
  const onChain = chains.length > 0;

  const { data, isLoading, isError, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: [
      "combined-ecosystem-stats",
      chains.map((c) => `${c.chainId}:${c.registry}`).join(","),
    ],
    queryFn: () => getCombinedEcosystemStats({ data: { chains } }),
    enabled: onChain,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  return {
    onChain,
    totalDeployments: data ? data.totalContracts : null,
    uniqueDeployers: data ? data.totalUsers : 0,
    /** Per-chain answers; null fields could not be read. */
    chains: data?.chains ?? [],
    complete: data?.complete ?? false,
    loading: onChain && isLoading,
    error: isError,
    fetching: isFetching,
    updatedAt: dataUpdatedAt,
    refetch,
  };
}
