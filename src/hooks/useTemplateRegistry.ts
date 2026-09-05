import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { templateRegistryAbi } from "@/lib/abis/templateRegistry";
import { templateRegistryAddress, isContractConfigured } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";

// The on-chain template marketplace.
//
// Templates published here are readable by anyone: the Solidity source lives
// on-chain, because ~2 KB costs about 0.0014 QIE and putting it behind a server
// would make the body the one part of a "decentralised marketplace" that isn't.
// What a price buys is attribution: paying is what records the deploy against
// the template, which is what pays the creator and grows their deployCount.

/** QIE's eth_estimateGas returns ~24k for calls that need far more, which
 *  silently runs writes out of gas: the same defect ONCHAIN_WRITE_GAS exists
 *  for. Publishing stores the whole source, so it needs far more headroom than
 *  the registry writes do: budget by source size rather than a flat number. */
export function publishGasFor(sourceBytes: number): bigint {
  // 20k gas per 32-byte storage word is the floor; the rest is slack for the
  // name/description/abi strings and the array push. Deliberately generous -
  // unused gas is refunded, whereas too little loses the transaction outright,
  // and QIE's own estimate cannot be trusted to catch that.
  const words = BigInt(Math.ceil(sourceBytes / 32));
  return 600_000n + words * 30_000n;
}

export interface OnChainTemplate {
  id: number;
  creator: string;
  price: bigint;
  createdAt: number;
  deployCount: number;
  active: boolean;
  name: string;
  description: string;
  source: string;
  abiJson: string;
}

interface Summary {
  id: number;
  creator: string;
  price: bigint;
  deployCount: number;
  active: boolean;
  name: string;
}

export function useTemplateRegistry() {
  const { address } = useAccount();
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const registry = templateRegistryAddress(chainId);
  const configured = isContractConfigured(registry);
  const client = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  /** Listing metadata only: deliberately without the source bodies, which
   *  would be tens of kilobytes of ABI-encoded strings in a single call. */
  const summaries = useQuery({
    queryKey: ["template-registry", "summaries", chainId],
    enabled: configured && !!client,
    staleTime: 30_000,
    queryFn: async (): Promise<Summary[]> => {
      const res = (await client!.readContract({
        address: registry,
        abi: templateRegistryAbi,
        functionName: "listSummaries",
        args: [BigInt(0), BigInt(50)],
      })) as [bigint[], string[], bigint[], bigint[], boolean[], string[]];
      const [ids, creators, prices, counts, actives, names] = res;
      return ids.map((id, i) => ({
        id: Number(id),
        creator: creators[i],
        price: prices[i],
        deployCount: Number(counts[i]),
        active: actives[i],
        name: names[i],
      }));
      // Delisted templates are returned too; callers filter. The contract keeps
      // them readable on purpose so an existing attributed deploy still
      // resolves to the template it used.
    },
  });

  /** One template including its full source. */
  const fetchTemplate = useCallback(
    async (id: number): Promise<OnChainTemplate | null> => {
      if (!configured || !client) return null;
      const t = (await client.readContract({
        address: registry,
        abi: templateRegistryAbi,
        functionName: "getTemplate",
        args: [BigInt(id)],
      })) as {
        creator: string;
        price: bigint;
        createdAt: bigint;
        deployCount: bigint;
        active: boolean;
        name: string;
        description: string;
        source: string;
        abiJson: string;
      };
      return {
        id,
        creator: t.creator,
        price: t.price,
        createdAt: Number(t.createdAt) * 1000,
        deployCount: Number(t.deployCount),
        active: t.active,
        name: t.name,
        description: t.description,
        source: t.source,
        abiJson: t.abiJson,
      };
    },
    [client, configured, registry],
  );

  const publish = useCallback(
    async (t: {
      name: string;
      description: string;
      source: string;
      abiJson: string;
      priceWei: bigint;
    }) => {
      if (!configured) throw new Error("No template registry on this network.");
      if (!address) throw new Error("Connect a wallet to publish.");
      return writeContractAsync({
        address: registry,
        abi: templateRegistryAbi,
        functionName: "publish",
        args: [t.name, t.description, t.source, t.abiJson, t.priceWei],
        gas: publishGasFor(t.source.length),
      });
    },
    [address, configured, registry, writeContractAsync],
  );

  /** Pay for and record a deploy against template `id`. */
  const payForDeploy = useCallback(
    async (id: number, priceWei: bigint) => {
      if (!configured) throw new Error("No template registry on this network.");
      return writeContractAsync({
        address: registry,
        abi: templateRegistryAbi,
        functionName: "deployWithTemplate",
        args: [BigInt(id)],
        value: priceWei,
        gas: 600_000n,
      });
    },
    [configured, registry, writeContractAsync],
  );

  const withdraw = useCallback(async () => {
    if (!configured) throw new Error("No template registry on this network.");
    return writeContractAsync({
      address: registry,
      abi: templateRegistryAbi,
      functionName: "withdraw",
      gas: 200_000n,
    });
  }, [configured, registry, writeContractAsync]);

  /** What this wallet is owed from template sales. */
  const earnings = useQuery({
    queryKey: ["template-registry", "pending", chainId, address],
    enabled: configured && !!client && !!address,
    staleTime: 30_000,
    queryFn: async (): Promise<bigint> =>
      (await client!.readContract({
        address: registry,
        abi: templateRegistryAbi,
        functionName: "pending",
        args: [address!],
      })) as bigint,
  });

  return {
    configured,
    registry,
    summaries: summaries.data ?? [],
    loading: summaries.isLoading,
    refetchSummaries: summaries.refetch,
    earnings: earnings.data ?? BigInt(0),
    refetchEarnings: earnings.refetch,
    fetchTemplate,
    publish,
    payForDeploy,
    withdraw,
  };
}
