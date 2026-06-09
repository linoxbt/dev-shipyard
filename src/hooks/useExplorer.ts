import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getExplorerData } from "@/lib/api/explorer.functions";
import { useExplorerNetwork, chainIdForSlug } from "@/lib/explorer/network";

// Generic explorer fetch hook, scoped to the network in the URL
// (/explorer/testnet|mainnet). `path` is a Blockscout v2 path like
// "/transactions" or "/addresses/0x..../logs".
export function useExplorer<T = unknown>(
  path: string | null,
  opts?: { refetchInterval?: number; enabled?: boolean },
) {
  const network = useExplorerNetwork();
  const chainId = chainIdForSlug(network);
  const query = useQuery({
    queryKey: ["explorer", chainId, path],
    queryFn: async () => {
      const res = (await getExplorerData({ data: { chainId, path: path as string } })) as
        | { ok: true; data: unknown }
        | { ok: false; error: string };
      if (!res.ok) throw new Error(res.error);
      return res.data as T;
    },
    enabled: (opts?.enabled ?? true) && !!path,
    refetchInterval: opts?.refetchInterval,
    placeholderData: keepPreviousData,
    staleTime: 5_000,
    retry: 1,
  });
  return query;
}

// Convenience: items + next_page_params from a Blockscout list response.
export interface PagedResponse<T> {
  items: T[];
  next_page_params: Record<string, unknown> | null;
}

// Build a path with Blockscout pagination params appended.
export function withPageParams(path: string, params: Record<string, unknown> | null): string {
  if (!params) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v != null) qs.set(k, String(v));
  }
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${qs.toString()}`;
}
