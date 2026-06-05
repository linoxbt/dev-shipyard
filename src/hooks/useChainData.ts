import { useQuery } from "@tanstack/react-query";
import { getNetworkStatus } from "@/lib/api/chain.functions";
import { qieTestnet } from "@/lib/chains";

// Live network status (block height, gas price), polled.
export function useNetworkStatus(chainId: number = qieTestnet.id) {
  return useQuery({
    queryKey: ["network-status", chainId],
    queryFn: () => getNetworkStatus({ data: { chainId } }),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
}
