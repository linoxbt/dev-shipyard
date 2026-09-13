import { useQuery } from "@tanstack/react-query";
import { readContract } from "wagmi/actions";
import { wagmiConfig } from "@/lib/wagmi";
import { qieIdAddress, isContractConfigured } from "@/lib/contracts";
import { QIE_ID_CHAIN_ID, qieIdAbi, type QieIdentity, type ResolvedName } from "@/lib/qie/identity";
import { loadIdentity, type IdentitySources } from "@/lib/qie/client";
import { getExplorerData } from "@/lib/api/explorer.functions";

// A wallet's QIE ID, wired to the real contract and the real explorer.
//
// Always read from QIE Mainnet, where QIE ID lives: a builder's name is the same
// whichever network the app is pointed at. The contract reads are authoritative;
// the explorer is how labels and wallet age are recovered. Every source may fail
// on its own: see lib/qie/client.ts.

const ZERO = "0x0000000000000000000000000000000000000000";

type Transfer = {
  from?: { hash?: string };
  total?: { token_id?: string };
  token?: { address_hash?: string; address?: string };
  transaction_hash?: string;
};

function makeSources(address: string): IdentitySources {
  const chainId = QIE_ID_CHAIN_ID;
  const contract = qieIdAddress(chainId);
  const configured = isContractConfigured(contract);

  // Through the server rather than from the page: the server validates the
  // path, fixes the host from chainId, and handles the explorer's certificate.
  const json = async (path: string) => {
    const res = await getExplorerData({ data: { chainId, path } });
    if (!res.ok) throw new Error(`explorer ${res.status}`);
    return (res.data ?? {}) as Record<string, unknown>;
  };
  const mintsOf = (items: Transfer[] | undefined) =>
    (items ?? []).filter(
      (t) =>
        (t.from?.hash ?? "").toLowerCase() === ZERO &&
        (t.token?.address_hash ?? t.token?.address ?? contract).toLowerCase() ===
          contract.toLowerCase(),
    );

  return {
    nameCount: async () => {
      if (!configured) return 0;
      const n = await readContract(wagmiConfig, {
        address: contract,
        abi: qieIdAbi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
        chainId,
      });
      return Number(n ?? 0n);
    },

    tokenIds: async (count) => {
      if (!configured) return [];
      const ids = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          readContract(wagmiConfig, {
            address: contract,
            abi: qieIdAbi,
            functionName: "tokenOfOwnerByIndex",
            args: [address as `0x${string}`, BigInt(i)],
            chainId,
          }).catch(() => null),
        ),
      );
      return ids.filter((id): id is bigint => id !== null).map((id) => id.toString());
    },

    mintTx: async (tokenId) => {
      const d = (await json(`/tokens/${contract}/instances/${tokenId}/transfers`)) as {
        items?: Transfer[];
      };
      return mintsOf(d.items)[0]?.transaction_hash ?? null;
    },

    mintedIn: async (txHash) => {
      const d = (await json(`/transactions/${txHash}/token-transfers`)) as { items?: Transfer[] };
      return mintsOf(d.items)
        .map((t) => t.total?.token_id)
        .filter((id): id is string => !!id);
    },

    txInput: async (txHash) => {
      const d = (await json(`/transactions/${txHash}`)) as { raw_input?: string };
      return d.raw_input ?? null;
    },

    firstSeenAt: async () => {
      // Age is the wallet's first ACTIVITY, not its first outgoing transaction:
      // a wallet that has only ever received has no transactions at all, and
      // reporting it as ageless would be wrong.
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

const isAddress = (a: string | undefined): a is string => !!a && /^0x[a-fA-F0-9]{40}$/.test(a);

/** A wallet's QIE identity: its `.qie` names and age. Null address fetches nothing. */
export function useQieIdentity(address: string | undefined) {
  return useQuery<QieIdentity | null>({
    queryKey: ["qie-identity", address?.toLowerCase()],
    enabled: isAddress(address),
    // Registrations do not change minute to minute, and each refresh costs
    // several explorer calls.
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async () => (isAddress(address) ? loadIdentity(address, makeSources(address)) : null),
  });
}

/** The wallet's first `.qie` name, for showing a builder by name anywhere in the
 *  app. Shares the identity query, so many callers for one wallet fetch once. */
export function useQieName(address: string | undefined): ResolvedName | null {
  const { data } = useQieIdentity(address);
  return data?.names[0] ?? null;
}
