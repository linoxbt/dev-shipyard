import { useQuery } from "@tanstack/react-query";
import { getBuilderOverview, type BuilderOverview } from "@/lib/api/builder.functions";

// A builder's whole on-chain picture, across every network DevStation runs on.
// One query per wallet, shared by every component that needs a piece of it.

export function useBuilderOverview(address: string | undefined) {
  const valid = !!address && /^0x[a-fA-F0-9]{40}$/.test(address);
  return useQuery<BuilderOverview>({
    queryKey: ["builder-overview", address?.toLowerCase()],
    enabled: valid,
    // Several RPC and explorer reads per network: worth caching, and a builder's
    // history does not change second to second.
    staleTime: 2 * 60 * 1000,
    retry: 1,
    queryFn: () => getBuilderOverview({ data: { address: address! } }),
  });
}
