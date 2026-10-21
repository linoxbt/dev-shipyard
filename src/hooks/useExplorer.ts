import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { getExplorerData } from "@/lib/api/explorer.functions";

import { useExplorerNetwork, chainIdForSlug } from "@/lib/explorer/network";

// Generic explorer fetch hook, scoped to the network in the URL
// (/explorer/testnet|mainnet). `path` is a Blockscout v2 path like
// "/transactions" or "/addresses/0x..../logs": the SAME path convention is
// Every supported chain is Blockscout-backed, so one fetcher serves them all.
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
        | { ok: false; status?: number; error: string };
      if (!res.ok) throw new ExplorerError(res.error, res.status ?? 502);
      return res.data as T;
    },
    enabled: (opts?.enabled ?? true) && !!path,
    refetchInterval: opts?.refetchInterval,
    // Only bridge the gap while paging through the SAME resource (the query
    // string changed). Showing address A's data under address B's URL, or
    // testnet data under a mainnet URL, is worse than a spinner.
    placeholderData: (prev, prevQuery) =>
      prevQuery && samePage(prevQuery.queryKey, chainId, path) ? keepPreviousData(prev) : undefined,
    staleTime: 5_000,
    // A 404 is an answer, not a blip: retrying it only delays "not found".
    retry: (count, err) => !(err instanceof ExplorerError && err.status === 404) && count < 1,
  });
  return query;
}

/** A failed explorer read, keeping the upstream status so a page can tell
 *  "this address does not exist" apart from "the explorer is down". */
export class ExplorerError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ExplorerError";
  }
}

/** True when the explorer answered that the resource does not exist. */
export function isNotFound(err: unknown): boolean {
  return err instanceof ExplorerError && err.status === 404;
}

/** Same chain and same resource, differing only in pagination params. */
function samePage(prevKey: readonly unknown[], chainId: number, path: string | null): boolean {
  const base = (p: unknown) => (typeof p === "string" ? p.split("?")[0] : null);
  return prevKey[1] === chainId && base(prevKey[2]) !== null && base(prevKey[2]) === base(path);
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

type Cursor = Record<string, unknown> | null;

/**
 * A Blockscout list walked with next_page_params, with a Prev stack.
 *
 * The stack belongs to one chain + list: switching network or address starts
 * again at page one, instead of replaying another chain's cursor against this
 * one (which returned a page from the middle of an unrelated list).
 */
export function usePagedExplorer<T>(basePath: string | null, opts?: { refetchInterval?: number }) {
  const chainId = chainIdForSlug(useExplorerNetwork());
  const owner = `${chainId}:${basePath ?? ""}`;
  const [state, setState] = useState<{ owner: string; stack: Cursor[] }>({
    owner,
    stack: [null],
  });
  const stack = state.owner === owner ? state.stack : [null];
  const cursor = stack[stack.length - 1];
  const query = useExplorer<PagedResponse<T>>(
    basePath ? withPageParams(basePath, cursor) : null,
    opts,
  );
  const next = query.data?.next_page_params ?? null;
  return {
    ...query,
    /** Zero-based page number, for ranks that continue across pages. */
    pageIndex: stack.length - 1,
    pager: {
      hasPrev: stack.length > 1,
      hasNext: !!next && !query.isFetching,
      onPrev: () => setState({ owner, stack: stack.length > 1 ? stack.slice(0, -1) : stack }),
      onNext: () => next && setState({ owner, stack: [...stack, next] }),
    },
  };
}
