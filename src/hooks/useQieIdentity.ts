import { useQuery } from "@tanstack/react-query";
import { readContract } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { qieIdAddress, isContractConfigured } from "@/lib/contracts";
import { qieIdAbi } from "@/lib/qie/identity";
import { loadIdentity, type ExplorerTransfer, type IdentitySources } from "@/lib/qie/client";
import type { QieIdentity } from "@/lib/qie/identity";
import { getExplorerData } from "@/lib/api/explorer.functions";

// Wiring the identity layer to the real chain and the real explorer.
//
// The contract reads are authoritative; the explorer calls are how the labels
// and the wallet's age are recovered, since neither is on chain in a readable
// form. Every source is allowed to fail independently — see client.ts.

const ownerOfAbi = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

function makeSources(address: string, chainId: number): IdentitySources {
  const contract = qieIdAddress(chainId);

  // Routed through the server rather than fetched from the page. The browser
  // enforces its own certificate check, so while QIE's explorer certificate is
  // invalid a client-side call fails outright and no server-side handling can
  // reach it. getExplorerData validates the path, fixes the host from chainId,
  // and shares the same scoped certificate handling as every other call.
  const json = async (path: string) => {
    const res = await getExplorerData({ data: { chainId, path } });
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    return (res.data ?? {}) as Record<string, unknown>;
  };

  return {
    nameCount: async () => {
      if (!isContractConfigured(contract)) return 0;
      const n = await readContract(wagmiConfig, {
        address: contract,
        abi: qieIdAbi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
        chainId,
      });
      return Number(n ?? 0n);
    },

    transfers: async (limit) => {
      // No registry on this chain means no names to look for. Without this
      // guard the request went out with an empty `token=` and the explorer
      // answered "Invalid parameter(s)" — a wasted round-trip on every load
      // on every non-QIE chain.
      if (!isContractConfigured(contract)) return [];
      // Mints of this token into the wallet — each one is a registration.
      const d = (await json(
        `/addresses/${address}/token-transfers?type=ERC-721&token=${contract}`,
      )) as { items?: Array<Record<string, unknown>> };
      const out: ExplorerTransfer[] = [];
      for (const item of d.items ?? []) {
        const to = ((item.to as { hash?: string })?.hash ?? "").toLowerCase();
        if (to !== address.toLowerCase()) continue;
        const tokenId = (item.total as { token_id?: string })?.token_id;
        const txHash = item.transaction_hash as string | undefined;
        if (tokenId && txHash) out.push({ tokenId, txHash });
        if (out.length >= limit) break;
      }
      return out;
    },

    txInput: async (txHash) => {
      const d = (await json(`/transactions/${txHash}`)) as { raw_input?: string };
      return d.raw_input ?? null;
    },

    ownerOf: async (tokenId) => {
      if (!isContractConfigured(contract)) return null;
      const owner = await readContract(wagmiConfig, {
        address: contract,
        abi: ownerOfAbi,
        functionName: "ownerOf",
        args: [BigInt(tokenId)],
        chainId,
      });
      return (owner as string) ?? null;
    },

    firstSeenAt: async () => {
      // Age is the wallet's first ACTIVITY, not its first outgoing
      // transaction. A wallet that has only ever received — which is the norm
      // for one holding a name someone else registered for it — has no
      // transactions at all, and reporting it as ageless would be wrong.
      // Not a QIE ID signal either way; QIE offers no wallet-age claim.
      const stamps: number[] = [];
      const collect = (items: Array<{ timestamp?: string }> | undefined) => {
        for (const t of items ?? []) {
          const ms = t.timestamp ? new Date(t.timestamp).getTime() : NaN;
          if (Number.isFinite(ms)) stamps.push(ms);
        }
      };

      const [txs, transfers] = await Promise.all([
        json(`/addresses/${address}/transactions`).catch(() => ({})),
        json(`/addresses/${address}/token-transfers`).catch(() => ({})),
      ]);
      collect((txs as { items?: Array<{ timestamp?: string }> }).items);
      collect((transfers as { items?: Array<{ timestamp?: string }> }).items);

      return stamps.length ? Math.min(...stamps) : null;
    },
  };
}

/** A wallet's QIE identity. Null address means nothing is fetched. */
export function useQieIdentity(address: string | undefined, chainId: number) {
  return useQuery<QieIdentity | null>({
    queryKey: ["qie-identity", address, chainId],
    enabled: !!address,
    // Registrations do not change minute to minute, and each refresh costs
    // several explorer calls.
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async () => {
      if (!address) return null;
      return loadIdentity(address, makeSources(address, chainId));
    },
  });
}
