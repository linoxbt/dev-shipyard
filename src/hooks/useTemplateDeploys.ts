import { useQuery } from "@tanstack/react-query";
import { getTemplateDeployCounts } from "@/lib/api/chain.functions";
import { projectRegistryAddress, isContractConfigured } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";

// Per-template onchain deploy counts (templateId -> count), read from the
// ProjectRegistry's recordDeployment transaction history for the selected chain.
export function useTemplateDeploys(): {
  counts: Record<string, number>;
  onChain: boolean;
} {
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const registry = projectRegistryAddress(chainId);
  const onChain = isContractConfigured(registry);

  const { data } = useQuery({
    queryKey: ["template-deploys", chainId, registry],
    queryFn: () => getTemplateDeployCounts({ data: { chainId, registry } }),
    enabled: onChain,
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  return { counts: data?.counts ?? {}, onChain };
}
