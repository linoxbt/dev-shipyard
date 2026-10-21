import { useQuery } from "@tanstack/react-query";
import { labelRegistryAddress, isContractConfigured } from "@/lib/contracts";
import { getAllLabels } from "@/lib/api/chain.functions";

export interface ChainLabel {
  name: string;
  /** Written by the registry's autoLabeler. Anything else is a community
   *  submission the registry lets anyone make first, for any address, so it
   *  is shown as unverified rather than as the contract's name. */
  trusted: boolean;
}

/**
 * The ContractLabelRegistry label for `address` on a SPECIFIC chain.
 *
 * useLabelName reads whichever chain the user has selected, which is wrong on
 * an explorer page: the URL names the chain. Shares the ["all-labels", chainId,
 * registry] cache key with useAllLabels, so it costs no extra fetch.
 */
export function useChainLabel(address: string | undefined, chainId: number): ChainLabel | null {
  const registry = labelRegistryAddress(chainId);
  const onChain = isContractConfigured(registry);
  const { data } = useQuery({
    queryKey: ["all-labels", chainId, registry],
    queryFn: () => getAllLabels({ data: { chainId, registry } }),
    enabled: onChain && !!address,
    staleTime: 15_000,
  });
  if (!address || !data) return null;
  const a = address.toLowerCase();
  const hit = data.labels.find((l) => l.address.toLowerCase() === a);
  return hit ? { name: hit.name, trusted: hit.autoLabeled } : null;
}
