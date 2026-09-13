import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { decodeEventLog, erc20Abi } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { devStationMarketplaceAbi } from "@/lib/abis/devStationMarketplace";
import { isContractConfigured, marketplaceAddress, qusdcAddress } from "@/lib/contracts";
import { useNetworkPref } from "@/lib/active-chain";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { bundleHash, bundleProblem, type Bundle } from "@/lib/marketplace/bundle";
import {
  currencyCode,
  currencyFromCode,
  kindCode,
  kindFromCode,
  modelCode,
  modelFromCode,
  parseMetadata,
  serializeMetadata,
  type Currency,
  type ListingKind,
  type ListingMetadata,
  type PricingModel,
} from "@/lib/marketplace/listing";

// DevStationMarketplace from the browser: reads, the payment flows, and the
// file upload and download that go with them.
//
// Every write waits for its receipt before returning. The pages refetch right
// after, and reading before the transaction is mined would show a purchase as
// not yet made, which is exactly when someone clicks Buy a second time.

export interface MarketSummary {
  id: number;
  creator: string;
  price: bigint;
  createdAt: number;
  featuredUntil: number;
  sales: number;
  deploys: number;
  kind: ListingKind;
  currency: Currency;
  model: PricingModel;
  active: boolean;
  hidden: boolean;
  name: string;
}

export interface MarketListing extends MarketSummary {
  description: string;
  metadata: ListingMetadata;
  contentHash: `0x${string}`;
}

/** QIE's gas estimate is unreliable for storage-heavy writes (see
 *  ONCHAIN_WRITE_GAS), so every write carries an explicit, generous limit.
 *  Unused gas is refunded; too little loses the transaction. */
function publishGas(textBytes: number): bigint {
  return 900_000n + BigInt(Math.ceil(textBytes / 32)) * 25_000n;
}
const PAY_GAS = 350_000n;
const APPROVE_GAS = 120_000n;

interface RawListing {
  creator: string;
  price: bigint;
  createdAt: bigint;
  featuredUntil: bigint;
  sales: bigint;
  deploys: bigint;
  kind: number;
  currency: number;
  model: number;
  active: boolean;
  hidden: boolean;
  contentHash: `0x${string}`;
  name: string;
  description: string;
  metadataJson: string;
}

function toSummary(
  id: number,
  raw: Omit<RawListing, "contentHash" | "description" | "metadataJson">,
): MarketSummary {
  return {
    id,
    creator: raw.creator,
    price: raw.price,
    createdAt: Number(raw.createdAt) * 1000,
    featuredUntil: Number(raw.featuredUntil) * 1000,
    sales: Number(raw.sales),
    deploys: Number(raw.deploys),
    kind: kindFromCode(Number(raw.kind)),
    currency: currencyFromCode(Number(raw.currency)),
    model: modelFromCode(Number(raw.model)),
    active: raw.active,
    hidden: raw.hidden,
    name: raw.name,
  };
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
}

export function useMarketplace() {
  const { address } = useAccount();
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const contract = marketplaceAddress(chainId);
  const configured = isContractConfigured(contract);
  const qusdc = qusdcAddress(chainId);
  const client = usePublicClient({ chainId });
  const { writeContractAsync } = useWriteContract();

  const summaries = useQuery({
    queryKey: ["marketplace", "summaries", chainId],
    enabled: configured && !!client,
    staleTime: 30_000,
    queryFn: async (): Promise<MarketSummary[]> => {
      const page = (await client!.readContract({
        address: contract,
        abi: devStationMarketplaceAbi,
        functionName: "listSummaries",
        args: [0n, 500n],
      })) as ReadonlyArray<
        { id: bigint } & Omit<RawListing, "contentHash" | "description" | "metadataJson">
      >;
      return page.map((row) => toSummary(Number(row.id), row));
    },
  });

  const fetchListing = useCallback(
    async (id: number): Promise<MarketListing | null> => {
      if (!configured || !client) return null;
      try {
        const raw = (await client.readContract({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName: "getListing",
          args: [BigInt(id)],
        })) as RawListing;
        return {
          ...toSummary(id, raw),
          description: raw.description,
          metadata: parseMetadata(raw.metadataJson),
          contentHash: raw.contentHash,
        };
      } catch {
        return null;
      }
    },
    [client, configured, contract],
  );

  const readIds =
    (functionName: "purchasesOf" | "listingsByCreator") => async (): Promise<number[]> =>
      (
        (await client!.readContract({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName,
          args: [address!],
        })) as readonly bigint[]
      ).map(Number);

  const purchases = useQuery({
    queryKey: ["marketplace", "purchases", chainId, address],
    enabled: configured && !!client && !!address,
    staleTime: 30_000,
    queryFn: readIds("purchasesOf"),
  });

  const mine = useQuery({
    queryKey: ["marketplace", "mine", chainId, address],
    enabled: configured && !!client && !!address,
    staleTime: 30_000,
    queryFn: readIds("listingsByCreator"),
  });

  const readPending = (token: `0x${string}`) =>
    client!.readContract({
      address: contract,
      abi: devStationMarketplaceAbi,
      functionName: "pending",
      args: [token, address!],
    }) as Promise<bigint>;

  const earnings = useQuery({
    queryKey: ["marketplace", "pending", chainId, address],
    enabled: configured && !!client && !!address,
    staleTime: 15_000,
    queryFn: async (): Promise<Record<Currency, bigint>> => ({
      QIE: await readPending("0x0000000000000000000000000000000000000000"),
      QUSDC: isContractConfigured(qusdc) ? await readPending(qusdc) : 0n,
    }),
  });

  const featuredPrices = useQuery({
    queryKey: ["marketplace", "featured-price", chainId],
    enabled: configured && !!client,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<Currency, bigint>> => {
      const read = (code: number) =>
        client!.readContract({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName: "featuredPricePerDay",
          args: [code],
        }) as Promise<bigint>;
      return { QIE: await read(0), QUSDC: await read(1) };
    },
  });

  const hasAccess = useCallback(
    async (id: number): Promise<boolean> => {
      if (!configured || !client || !address) return false;
      return (await client.readContract({
        address: contract,
        abi: devStationMarketplaceAbi,
        functionName: "hasAccess",
        args: [BigInt(id), address],
      })) as boolean;
    },
    [address, client, configured, contract],
  );

  const mined = useCallback(
    async (hash: `0x${string}`) => {
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction failed on-chain.");
      return receipt;
    },
    [client],
  );

  const requireReady = useCallback(() => {
    if (!configured || !client) throw new Error("The marketplace is not live on this network yet.");
    if (!address) throw new Error("Connect a wallet first.");
  }, [address, client, configured]);

  /** Makes sure the marketplace may pull `amount` QUSDC, asking once if not. */
  const ensureAllowance = useCallback(
    async (amount: bigint) => {
      if (amount === 0n) return;
      if (!isContractConfigured(qusdc)) throw new Error("QUSDC is not available on this network.");
      const allowance = (await client!.readContract({
        address: qusdc,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address!, contract],
      })) as bigint;
      if (allowance >= amount) return;
      const balance = (await client!.readContract({
        address: qusdc,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address!],
      })) as bigint;
      if (balance < amount) throw new Error("Not enough QUSDC in this wallet.");
      await mined(
        await writeContractAsync({
          address: qusdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [contract, amount],
          gas: APPROVE_GAS,
        }),
      );
    },
    [address, client, contract, mined, qusdc, writeContractAsync],
  );

  /** Sends a payable call in the listing's currency: QIE as value, QUSDC after approval. */
  const pay = useCallback(
    async (
      functionName: "buy" | "recordDeploy" | "tip" | "feature",
      args: readonly bigint[],
      currency: Currency,
      amount: bigint,
    ) => {
      requireReady();
      if (currency === "QUSDC") await ensureAllowance(amount);
      return mined(
        await writeContractAsync({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName,
          args: args as never,
          value: currency === "QIE" ? amount : 0n,
          gas: PAY_GAS,
        }),
      );
    },
    [contract, ensureAllowance, mined, requireReady, writeContractAsync],
  );

  const uploadFiles = useCallback(
    async (id: number, files: Bundle) => {
      const res = await fetchWithGrant("/api/listings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chainId, id, files }),
      });
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.message ?? "Uploading the files failed."));
    },
    [chainId],
  );

  /** A listing's files, checked against the hash recorded on-chain. */
  const downloadFiles = useCallback(
    async (listing: Pick<MarketListing, "id" | "contentHash">): Promise<Bundle> => {
      const url = `/api/listings?chainId=${chainId}&id=${listing.id}`;
      const res = await fetchWithGrant(url);
      const body = await readJson(res);
      if (!res.ok) throw new Error(String(body.message ?? "Downloading the files failed."));
      const files = body.files as Bundle;
      if (bundleProblem(files)) throw new Error("The files that came back are not valid.");
      if ((await bundleHash(files)).toLowerCase() !== listing.contentHash.toLowerCase()) {
        throw new Error("These files do not match what was listed. Nothing was opened.");
      }
      return files;
    },
    [chainId],
  );

  const publish = useCallback(
    async (input: {
      kind: ListingKind;
      currency: Currency;
      model: PricingModel;
      price: bigint;
      name: string;
      description: string;
      metadata: ListingMetadata;
      files: Bundle;
    }): Promise<{ id: number }> => {
      requireReady();
      const problem = bundleProblem(input.files);
      if (problem) throw new Error(problem);
      const contentHash = await bundleHash(input.files);
      const metadataJson = serializeMetadata(input.metadata);
      const textBytes = new TextEncoder().encode(
        input.name + input.description + metadataJson,
      ).length;
      const receipt = await mined(
        await writeContractAsync({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName: "publish",
          args: [
            kindCode(input.kind),
            currencyCode(input.currency),
            modelCode(input.model),
            input.price,
            input.name,
            input.description,
            metadataJson,
            contentHash,
          ],
          gas: publishGas(textBytes),
        }),
      );
      let id: number | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
        try {
          const event = decodeEventLog({
            abi: devStationMarketplaceAbi,
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName === "ListingPublished")
            id = Number((event.args as { id: bigint }).id);
        } catch {
          // Not one of ours.
        }
      }
      if (id === null)
        throw new Error("Published, but the listing id could not be read from the receipt.");
      await uploadFiles(id, input.files);
      return { id };
    },
    [contract, mined, requireReady, uploadFiles, writeContractAsync],
  );

  const update = useCallback(
    async (id: number, price: bigint, active: boolean, metadata: ListingMetadata) => {
      requireReady();
      const metadataJson = serializeMetadata(metadata);
      return mined(
        await writeContractAsync({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName: "update",
          args: [BigInt(id), price, active, metadataJson],
          gas: publishGas(new TextEncoder().encode(metadataJson).length),
        }),
      );
    },
    [contract, mined, requireReady, writeContractAsync],
  );

  const withdraw = useCallback(
    async (currency: Currency) => {
      requireReady();
      return mined(
        await writeContractAsync({
          address: contract,
          abi: devStationMarketplaceAbi,
          functionName: "withdraw",
          args: [currency === "QIE" ? "0x0000000000000000000000000000000000000000" : qusdc],
          gas: 200_000n,
        }),
      );
    },
    [contract, mined, qusdc, requireReady, writeContractAsync],
  );

  const buy = useCallback(
    (listing: MarketSummary) => pay("buy", [BigInt(listing.id)], listing.currency, listing.price),
    [pay],
  );
  const recordDeploy = useCallback(
    (listing: MarketSummary) =>
      pay(
        "recordDeploy",
        [BigInt(listing.id)],
        listing.currency,
        address?.toLowerCase() === listing.creator.toLowerCase() ? 0n : listing.price,
      ),
    [address, pay],
  );
  const tip = useCallback(
    (listing: MarketSummary, amount: bigint) =>
      pay("tip", [BigInt(listing.id), amount], listing.currency, amount),
    [pay],
  );
  const feature = useCallback(
    (listing: MarketSummary, days: number) => {
      const perDay = featuredPrices.data?.[listing.currency] ?? 0n;
      if (perDay === 0n) throw new Error("Featuring is not open yet for this currency.");
      return pay(
        "feature",
        [BigInt(listing.id), BigInt(days)],
        listing.currency,
        perDay * BigInt(days),
      );
    },
    [featuredPrices.data, pay],
  );

  return {
    chainId,
    address,
    configured,
    contract,
    qusdcAvailable: isContractConfigured(qusdc),
    summaries: summaries.data ?? [],
    loading: summaries.isLoading,
    refetchSummaries: summaries.refetch,
    purchases: purchases.data ?? [],
    refetchPurchases: purchases.refetch,
    mine: mine.data ?? [],
    refetchMine: mine.refetch,
    earnings: earnings.data ?? { QIE: 0n, QUSDC: 0n },
    refetchEarnings: earnings.refetch,
    featuredPrices: featuredPrices.data ?? { QIE: 0n, QUSDC: 0n },
    fetchListing,
    hasAccess,
    publish,
    uploadFiles,
    downloadFiles,
    update,
    withdraw,
    buy,
    recordDeploy,
    tip,
    feature,
  };
}
