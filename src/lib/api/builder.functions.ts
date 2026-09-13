import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createPublicClient,
  decodeFunctionData,
  erc20Abi,
  fallback,
  http,
  parseAbiItem,
  toFunctionSelector,
  type PublicClient,
} from "viem";
import { SUPPORTED_CHAINS, chainConfig } from "@/lib/chains";
import { devStationMarketplaceAbi } from "@/lib/abis/devStationMarketplace";
import { contractLabelRegistryAbi } from "@/lib/abis/contractLabelRegistry";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import {
  isContractConfigured,
  labelRegistryAddress,
  marketplaceAddress,
  marketplaceDeployBlock,
  projectRegistryAddress,
  qusdcAddress,
} from "@/lib/contracts";
import { fetchExplorer } from "@/lib/api/explorer-fetch";
import { readDeployerProfile, readLeaderboard, templateCredit } from "@/lib/api/profile.functions";

// Everything DevStation can say about one builder, on every network it runs on.
//
// One call so the dashboard renders from a single consistent snapshot instead of
// a dozen independent loading states. Every source is read on its own and may
// fail on its own: a section reports `null` (could not be read) separately from
// empty (read, and there is nothing), because "the explorer is down" and "this
// builder has no transactions" are different statements about a person.
//
// Nothing here is self-reported. Deployments come from ProjectRegistry, sales
// and tips from DevStationMarketplace events, labels from ContractLabelRegistry
// transactions, balances and activity from the chain and its explorer, and
// published apps from the runner that hosts them.

const input = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/) });

const ZERO = "0x0000000000000000000000000000000000000000";
const MAX_ACTIVITY_PAGES = 3;
const MAX_EVENT_BLOCKS = 80;

export type Amounts = { QIE: string; QUSDC: string };

export interface BuilderDeployment {
  contractAddress: string;
  templateId: string;
  projectName: string;
  deployedAt: number;
  txHash: string;
  /** null when the explorer could not say. */
  verified: boolean | null;
}

export interface BuilderListing {
  id: number;
  name: string;
  kind: number;
  currency: number;
  model: number;
  price: string;
  sales: number;
  deploys: number;
  active: boolean;
  hidden: boolean;
  featuredUntil: number;
  createdAt: number;
}

export interface BuilderMarketEvent {
  type: "listing" | "sale" | "deploy-sale" | "tip" | "purchase";
  listingId: number;
  at: number;
  /** Smallest unit of `currency`. */
  amount: string;
  currency: "QIE" | "QUSDC";
  txHash: string;
  counterparty: string;
}

export interface BuilderChain {
  chainId: number;
  name: string;
  testnet: boolean;
  deployments: {
    total: number;
    items: BuilderDeployment[];
    verified: number;
    /** How many of the items the explorer was asked about. */
    checked: number;
    templatesPublished: number | null;
    templateDeploys: number | null;
  } | null;
  rank: { rank: number; of: number } | null;
  marketplace: {
    listings: BuilderListing[];
    sales: number;
    paidDeploys: number;
    tipsReceived: number;
    purchases: number;
    earned: Amounts;
    tips: Amounts;
    pending: Amounts;
    events: BuilderMarketEvent[];
    /** False when the event history could not be read. */
    eventsAvailable: boolean;
  } | null;
  labels: Array<{
    address: string;
    name: string;
    category: string;
    at: number;
    txHash: string;
  }> | null;
  wallet: {
    balance: string | null;
    qusdc: string | null;
    txCount: number | null;
    tokenTransfers: number | null;
    gasUsed: string | null;
    /** Recent transaction timestamps, ms, for the activity graph. */
    activity: number[];
  } | null;
}

export interface BuilderOverview {
  address: string;
  chains: BuilderChain[];
  sites: Array<{
    slug: string;
    url: string;
    createdAt: number;
    updatedAt: number;
    fileCount: number;
    bytes: number;
  }> | null;
  readAt: number;
}

function clientFor(chainId: number): PublicClient {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId)!;
  return createPublicClient({
    chain,
    transport: fallback(chain.rpcUrls.default.http.map((url) => http(url))),
  }) as PublicClient;
}

async function explorerJson(chainId: number, path: string): Promise<Record<string, unknown>> {
  const base = chainConfig(chainId).explorerUrl.replace(/\/$/, "");
  const res = await fetchExplorer(`${base}/api/v2${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`explorer ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

const RECORD_DEPLOYMENT = toFunctionSelector(
  "recordDeployment(address,string,string,string,string)",
).toLowerCase();

async function verifiedOnExplorer(chainId: number, contract: string): Promise<boolean | null> {
  try {
    const d = await explorerJson(chainId, `/smart-contracts/${contract}`);
    return d.is_verified === true;
  } catch (e) {
    return e instanceof Error && e.message === "explorer 404" ? false : null;
  }
}

/**
 * Deployments rebuilt from the wallet's own recordDeployment transactions.
 *
 * For a registry whose views cannot run: QIE Testnet's ProjectRegistry was
 * compiled with MCOPY, which QIE's EVM lacks, so getDeployments reverts there.
 * The transactions that wrote each record are still on chain, and their
 * calldata carries the same fields.
 */
async function deploymentsFromTransactions(
  chainId: number,
  address: string,
): Promise<BuilderChain["deployments"]> {
  const registry = projectRegistryAddress(chainId);
  const api = chainConfig(chainId).explorerApiUrl;
  const res = await fetchExplorer(
    `${api}?module=account&action=txlist&address=${address}&sort=desc`,
  );
  const json = (await res.json()) as {
    result?: Array<{
      to?: string;
      input?: string;
      isError?: string;
      timeStamp?: string;
      hash?: string;
    }>;
  };
  const rows = (Array.isArray(json.result) ? json.result : []).filter(
    (t) =>
      t.to?.toLowerCase() === registry.toLowerCase() &&
      t.isError === "0" &&
      (t.input ?? "").toLowerCase().startsWith(RECORD_DEPLOYMENT),
  );
  const decoded = rows
    .map((t) => {
      try {
        const call = decodeFunctionData({
          abi: projectRegistryAbi,
          data: t.input as `0x${string}`,
        });
        if (call.functionName !== "recordDeployment") return null;
        const [contractAddress, templateId, projectName, , txHash] = call.args as readonly string[];
        return {
          contractAddress,
          templateId,
          projectName,
          deployedAt: Number(t.timeStamp ?? 0) * 1000,
          txHash: txHash || t.hash || "",
        };
      } catch {
        return null;
      }
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const sample = decoded.slice(0, 40);
  const checks = await Promise.all(
    sample.map((d) => verifiedOnExplorer(chainId, d.contractAddress)),
  );
  const items: BuilderDeployment[] = decoded.map((d, i) => ({
    ...d,
    verified: i < sample.length ? checks[i] : null,
  }));
  return {
    total: decoded.length,
    items,
    verified: items.filter((d) => d.verified === true).length,
    checked: checks.filter((c) => c !== null).length,
    templatesPublished: null,
    templateDeploys: null,
  };
}

async function readDeployments(
  chainId: number,
  address: string,
): Promise<BuilderChain["deployments"]> {
  if (!isContractConfigured(projectRegistryAddress(chainId))) return null;
  const profile = await readDeployerProfile({ chainId, address });
  if (!profile.available) {
    return profile.reason === "unreachable" ? deploymentsFromTransactions(chainId, address) : null;
  }
  const verifiedSet = profile.verifiedAddresses ? new Set(profile.verifiedAddresses) : null;
  const checkedCount = verifiedSet ? Math.min(profile.deployments.length, 40) : 0;
  const items: BuilderDeployment[] = profile.deployments.map((d, i) => ({
    contractAddress: d.contractAddress,
    templateId: d.templateId,
    projectName: d.projectName,
    deployedAt: Number(d.deployedAt),
    txHash: d.txHash,
    verified:
      verifiedSet && i < checkedCount ? verifiedSet.has(d.contractAddress.toLowerCase()) : null,
  }));
  return {
    total: profile.totalDeployments,
    items,
    verified: items.filter((d) => d.verified === true).length,
    checked: checkedCount,
    templatesPublished: profile.templatesAvailable ? profile.reputation.templatesPublished : null,
    templateDeploys: profile.templatesAvailable ? profile.reputation.templateDeploys : null,
  };
}

async function readRank(chainId: number, address: string): Promise<BuilderChain["rank"]> {
  if (!isContractConfigured(projectRegistryAddress(chainId))) return null;
  const board = await readLeaderboard({ chainId, limit: 100 });
  if (!board.available) return null;
  const entry = board.entries.find((e) => e.address === address.toLowerCase());
  return entry ? { rank: entry.rank, of: board.entries.length } : null;
}

const EVENTS = {
  published: parseAbiItem(
    "event ListingPublished(uint256 indexed id, address indexed creator, uint8 kind, uint8 currency, uint8 model, uint256 price, string name, bytes32 contentHash)",
  ),
  purchased: parseAbiItem(
    "event Purchased(uint256 indexed id, address indexed buyer, address indexed creator, uint8 currency, uint256 paid, uint256 fee)",
  ),
  deployed: parseAbiItem(
    "event DeployRecorded(uint256 indexed id, address indexed deployer, address indexed creator, uint8 currency, uint256 paid, uint256 fee)",
  ),
  tipped: parseAbiItem(
    "event Tipped(uint256 indexed id, address indexed from, address indexed creator, uint8 currency, uint256 amount)",
  ),
};

async function readMarketplace(
  chainId: number,
  address: string,
): Promise<BuilderChain["marketplace"]> {
  const contract = marketplaceAddress(chainId);
  if (!isContractConfigured(contract)) return null;
  const client = clientFor(chainId);
  const wallet = address as `0x${string}`;
  const qusdc = qusdcAddress(chainId);
  const read = <T>(functionName: string, args: readonly unknown[]) =>
    client.readContract({
      address: contract,
      abi: devStationMarketplaceAbi,
      functionName: functionName as never,
      args: args as never,
    }) as Promise<T>;

  const [ids, purchases, pendingQie, pendingUsd] = await Promise.all([
    read<readonly bigint[]>("listingsByCreator", [wallet]),
    read<readonly bigint[]>("purchasesOf", [wallet]),
    read<bigint>("pending", [ZERO, wallet]),
    isContractConfigured(qusdc) ? read<bigint>("pending", [qusdc, wallet]) : Promise.resolve(0n),
  ]);

  const mine = new Set(ids.map((id) => Number(id)));
  let listings: BuilderListing[] = [];
  if (mine.size > 0) {
    const page = await read<
      ReadonlyArray<{
        id: bigint;
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
        name: string;
      }>
    >("listSummaries", [0n, 500n]);
    listings = page
      .filter((row) => mine.has(Number(row.id)))
      .map((row) => ({
        id: Number(row.id),
        name: row.name,
        kind: Number(row.kind),
        currency: Number(row.currency),
        model: Number(row.model),
        price: row.price.toString(),
        sales: Number(row.sales),
        deploys: Number(row.deploys),
        active: row.active,
        hidden: row.hidden,
        featuredUntil: Number(row.featuredUntil) * 1000,
        createdAt: Number(row.createdAt) * 1000,
      }));
  }

  const earned = { QIE: 0n, QUSDC: 0n };
  const tips = { QIE: 0n, QUSDC: 0n };
  let sales = 0;
  let paidDeploys = 0;
  let tipsReceived = 0;
  let events: BuilderMarketEvent[] = [];
  let eventsAvailable = false;

  const fromBlock = marketplaceDeployBlock(chainId);
  if (fromBlock !== null) {
    try {
      const range = { address: contract, fromBlock, toBlock: "latest" as const };
      const [published, sold, deployedLogs, tipped, bought] = await Promise.all([
        client.getLogs({ ...range, event: EVENTS.published, args: { creator: wallet } }),
        client.getLogs({ ...range, event: EVENTS.purchased, args: { creator: wallet } }),
        client.getLogs({ ...range, event: EVENTS.deployed, args: { creator: wallet } }),
        client.getLogs({ ...range, event: EVENTS.tipped, args: { creator: wallet } }),
        client.getLogs({ ...range, event: EVENTS.purchased, args: { buyer: wallet } }),
      ]);
      const blocks = [
        ...new Set(
          [...published, ...sold, ...deployedLogs, ...tipped, ...bought].map((l) => l.blockNumber),
        ),
      ]
        .sort((a, b) => (a > b ? -1 : 1))
        .slice(0, MAX_EVENT_BLOCKS);
      const times = new Map<bigint, number>();
      await Promise.all(
        blocks.map(async (n) => {
          const block = await client.getBlock({ blockNumber: n }).catch(() => null);
          if (block) times.set(n, Number(block.timestamp) * 1000);
        }),
      );
      const at = (n: bigint) => times.get(n) ?? 0;
      const cur = (code: number): "QIE" | "QUSDC" => (code === 1 ? "QUSDC" : "QIE");

      for (const l of published) {
        events.push({
          type: "listing",
          listingId: Number(l.args.id),
          at: at(l.blockNumber),
          amount: (l.args.price ?? 0n).toString(),
          currency: cur(Number(l.args.currency)),
          txHash: l.transactionHash,
          counterparty: wallet,
        });
      }
      for (const l of sold) {
        const creatorShare = (l.args.paid ?? 0n) - (l.args.fee ?? 0n);
        if (l.args.buyer?.toLowerCase() !== wallet.toLowerCase()) sales++;
        earned[cur(Number(l.args.currency))] += creatorShare;
        events.push({
          type: "sale",
          listingId: Number(l.args.id),
          at: at(l.blockNumber),
          amount: creatorShare.toString(),
          currency: cur(Number(l.args.currency)),
          txHash: l.transactionHash,
          counterparty: l.args.buyer ?? ZERO,
        });
      }
      for (const l of deployedLogs) {
        const creatorShare = (l.args.paid ?? 0n) - (l.args.fee ?? 0n);
        if ((l.args.paid ?? 0n) > 0n) paidDeploys++;
        earned[cur(Number(l.args.currency))] += creatorShare;
        if ((l.args.paid ?? 0n) === 0n) continue;
        events.push({
          type: "deploy-sale",
          listingId: Number(l.args.id),
          at: at(l.blockNumber),
          amount: creatorShare.toString(),
          currency: cur(Number(l.args.currency)),
          txHash: l.transactionHash,
          counterparty: l.args.deployer ?? ZERO,
        });
      }
      for (const l of tipped) {
        tipsReceived++;
        tips[cur(Number(l.args.currency))] += l.args.amount ?? 0n;
        events.push({
          type: "tip",
          listingId: Number(l.args.id),
          at: at(l.blockNumber),
          amount: (l.args.amount ?? 0n).toString(),
          currency: cur(Number(l.args.currency)),
          txHash: l.transactionHash,
          counterparty: l.args.from ?? ZERO,
        });
      }
      for (const l of bought) {
        events.push({
          type: "purchase",
          listingId: Number(l.args.id),
          at: at(l.blockNumber),
          amount: (l.args.paid ?? 0n).toString(),
          currency: cur(Number(l.args.currency)),
          txHash: l.transactionHash,
          counterparty: l.args.creator ?? ZERO,
        });
      }
      events = events.sort((a, b) => b.at - a.at);
      eventsAvailable = true;
    } catch {
      // Event history is a bonus over the contract state above; losing it
      // leaves listings, purchases and balances intact.
      sales = listings.reduce((n, l) => n + l.sales, 0);
      paidDeploys = listings.reduce((n, l) => n + l.deploys, 0);
    }
  } else {
    sales = listings.reduce((n, l) => n + l.sales, 0);
    paidDeploys = listings.reduce((n, l) => n + l.deploys, 0);
  }

  return {
    listings,
    sales,
    paidDeploys,
    tipsReceived,
    purchases: purchases.length,
    earned: { QIE: earned.QIE.toString(), QUSDC: earned.QUSDC.toString() },
    tips: { QIE: tips.QIE.toString(), QUSDC: tips.QUSDC.toString() },
    pending: { QIE: pendingQie.toString(), QUSDC: pendingUsd.toString() },
    events,
    eventsAvailable,
  };
}

const SUBMIT_LABEL = toFunctionSelector(
  "submitLabel(address,string,string,string,bool)",
).toLowerCase();

async function readLabels(chainId: number, address: string): Promise<BuilderChain["labels"]> {
  const registry = labelRegistryAddress(chainId);
  if (!isContractConfigured(registry)) return null;
  const api = chainConfig(chainId).explorerApiUrl;
  const res = await fetchExplorer(
    `${api}?module=account&action=txlist&address=${address}&sort=desc`,
  );
  const json = (await res.json()) as {
    result?: Array<{
      to?: string;
      input?: string;
      isError?: string;
      timeStamp?: string;
      hash?: string;
    }>;
  };
  const out: NonNullable<BuilderChain["labels"]> = [];
  for (const t of Array.isArray(json.result) ? json.result : []) {
    if (t.to?.toLowerCase() !== registry.toLowerCase() || t.isError !== "0") continue;
    if (!(t.input ?? "").toLowerCase().startsWith(SUBMIT_LABEL)) continue;
    try {
      const decoded = decodeFunctionData({
        abi: contractLabelRegistryAbi,
        data: t.input as `0x${string}`,
      });
      if (decoded.functionName !== "submitLabel") continue;
      out.push({
        address: decoded.args[0] as string,
        name: decoded.args[1] as string,
        category: decoded.args[2] as string,
        at: Number(t.timeStamp ?? 0) * 1000,
        txHash: t.hash ?? "",
      });
    } catch {
      /* not a label this ABI can read */
    }
  }
  return out;
}

async function readWallet(chainId: number, address: string): Promise<BuilderChain["wallet"]> {
  const client = clientFor(chainId);
  const qusdc = qusdcAddress(chainId);
  const [info, counters, balance, usd] = await Promise.all([
    explorerJson(chainId, `/addresses/${address}`).catch(() => null),
    explorerJson(chainId, `/addresses/${address}/counters`).catch(() => null),
    client.getBalance({ address: address as `0x${string}` }).catch(() => null),
    isContractConfigured(qusdc)
      ? client
          .readContract({
            address: qusdc,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [address as `0x${string}`],
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const activity: number[] = [];
  let query = "";
  for (let page = 0; page < MAX_ACTIVITY_PAGES; page++) {
    const d = await explorerJson(chainId, `/addresses/${address}/transactions${query}`).catch(
      () => null,
    );
    if (!d) break;
    for (const t of (d.items as Array<{ timestamp?: string; from?: { hash?: string } }>) ?? []) {
      // Things this wallet did, not things sent to it.
      if ((t.from?.hash ?? "").toLowerCase() !== address.toLowerCase()) continue;
      const ms = t.timestamp ? new Date(t.timestamp).getTime() : NaN;
      if (Number.isFinite(ms)) activity.push(ms);
    }
    const next = d.next_page_params as Record<string, string | number> | null | undefined;
    if (!next) break;
    query = `?${new URLSearchParams(Object.entries(next).map(([k, v]) => [k, String(v)]))}`;
  }

  if (!info && !counters && balance === null) return null;
  const num = (v: unknown) => (v === undefined || v === null ? null : Number(v));
  return {
    balance: balance !== null ? balance.toString() : ((info?.coin_balance as string) ?? null),
    qusdc: usd !== null ? (usd as bigint).toString() : null,
    txCount: num(counters?.transactions_count),
    tokenTransfers: num(counters?.token_transfers_count),
    gasUsed: (counters?.gas_usage_count as string) ?? null,
    activity,
  };
}

async function readSites(address: string): Promise<BuilderOverview["sites"]> {
  const url = (process.env.RUNNER_URL ?? "").replace(/\/+$/, "");
  const token = process.env.RUNNER_TOKEN ?? "";
  if (!url || !token) return null;
  const res = await fetch(`${url}/publish`, {
    headers: { authorization: `Bearer ${token}`, "x-devstation-owner": address },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    sites?: Array<{
      slug: string;
      createdAt: number;
      updatedAt: number;
      fileCount: number;
      bytes: number;
    }>;
  };
  return (body.sites ?? []).map((s) => ({ ...s, url: `https://${s.slug}.devstation.online` }));
}

/** The networks worth reading: any with a DevStation contract on it. */
function builderChains() {
  return SUPPORTED_CHAINS.filter(
    (c) =>
      isContractConfigured(projectRegistryAddress(c.id)) ||
      isContractConfigured(marketplaceAddress(c.id)),
  );
}

export async function readBuilderOverview(address: string): Promise<BuilderOverview> {
  const settle = <T>(p: Promise<T>) => p.catch(() => null);
  const chains = await Promise.all(
    builderChains().map(async (chain): Promise<BuilderChain> => {
      const [deployments, rank, marketplace, labels, wallet] = await Promise.all([
        settle(readDeployments(chain.id, address)),
        settle(readRank(chain.id, address)),
        settle(readMarketplace(chain.id, address)),
        settle(readLabels(chain.id, address)),
        settle(readWallet(chain.id, address)),
      ]);
      return {
        chainId: chain.id,
        name: chain.name,
        testnet: chain.testnet === true,
        deployments,
        rank,
        marketplace,
        labels,
        wallet,
      };
    }),
  );
  const sites = await settle(readSites(address));
  // Mainnet first: it is where a builder's real standing is.
  chains.sort((a, b) => Number(a.testnet) - Number(b.testnet));
  return { address: address.toLowerCase(), chains, sites, readAt: Date.now() };
}

export const getBuilderOverview = createServerFn({ method: "GET" })
  .inputValidator(input)
  .handler(({ data }) => readBuilderOverview(data.address));

// templateCredit stays exported from profile.functions for callers that only
// want the legacy registry numbers.
export { templateCredit };
