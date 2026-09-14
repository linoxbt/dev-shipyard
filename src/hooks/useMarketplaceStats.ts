import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getMarketplaceStats,
  recordMarketplaceActivity,
} from "@/lib/api/marketplace-stats.functions";
import { useNetworkPref } from "@/lib/active-chain";

// What every marketplace item shows besides its price: tips from the chain,
// and clones and downloads counted by DevStation. Sales and deploys come with
// the listings themselves (useMarketplace, useTemplateDeploys).

export function useMarketplaceStats() {
  const chainId = useNetworkPref((s) => s.preferredChainId);
  return useQuery({
    queryKey: ["marketplace", "stats", chainId],
    staleTime: 60_000,
    queryFn: () => getMarketplaceStats({ data: { chainId } }),
  });
}

/** Records a clone or download of a listing (b-…, m-…, t-…). Fire and forget:
 *  counting must never get in the way of the person getting what they asked for. */
export function useRecordActivity() {
  const queryClient = useQueryClient();
  return useCallback(
    (listing: string, action: "clone" | "download") => {
      void recordMarketplaceActivity({ data: { listing, action } })
        .then((result) => {
          if (result.counted) {
            void queryClient.invalidateQueries({ queryKey: ["marketplace", "stats"] });
          }
        })
        .catch(() => undefined);
    },
    [queryClient],
  );
}
