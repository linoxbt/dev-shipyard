import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, fallback, http } from "viem";
import { SUPPORTED_CHAINS, chainConfig, qieTestnet } from "@/lib/chains";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import {
  marketplaceAddress,
  projectRegistryAddress,
  templateRegistryAddress,
  isContractConfigured,
} from "@/lib/contracts";
import { templateRegistryAbi } from "@/lib/abis/templateRegistry";
import { devStationMarketplaceAbi } from "@/lib/abis/devStationMarketplace";
import { deriveReputation, type DeploymentLike, type TemplateCredit } from "@/lib/reputation";
import { Tally, rankBuilders, type Activity, type BoardEntry } from "@/lib/leaderboard";
import { fetchExplorer } from "@/lib/api/explorer-fetch";

// Developer profiles and the leaderboard, derived from on-chain facts only.
//
// Nothing here is self-reported. A profile is what ProjectRegistry says the
// wallet deployed, plus what the explorer says about those contracts' source
// verification. A developer cannot raise their own standing by editing a field,
// which is the whole point: a reputation you can type in is worthless.
//
// There is no database. The Phase 4 sketch assumed one would index deployers
// for the leaderboard; instead the leaderboard is rebuilt from the explorer's
// indexed tx list, the same source getEcosystemStats already uses for unique
// wallets. ProjectRegistry deliberately exposes no way to enumerate deployers
// (getDeployments takes an address), so the addresses must come from the
// recordDeployment transactions themselves.

function clientFor(chainId: number) {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? qieTestnet;
  return createPublicClient({
    chain,
    transport: fallback(chain.rpcUrls.default.http.map((url) => http(url))),
  });
}

const RECORD_DEPLOYMENT_SELECTOR = "0x4311b312"; // recordDeployment(address,string,string,string,string)

/** How many contracts to ask the explorer about per profile. Verification is
 *  one request per contract, so a prolific deployer would otherwise fan out
 *  into hundreds: the rate is computed over this sample and says so. */
const MAX_VERIFICATION_CHECKS = 40;

/** How many templates to scan when summing a creator's deploys. The registry
 *  has no per-creator aggregate, so the summaries have to be read and filtered.
 *  Well above any realistic count today; if the marketplace ever outgrows it,
 *  page rather than raise it. */
const MAX_TEMPLATE_SCAN = 200;

/** Templates this developer published, and how often others deployed them.
 *
 *  Returns null when there is no registry on the chain or it cannot be read -
 *  so "no marketplace here" never renders as "published nothing". */
export async function templateCredit(
  chainId: number,
  address: string,
): Promise<TemplateCredit | null> {
  const registry = templateRegistryAddress(chainId);
  if (!isContractConfigured(registry)) return null;
  try {
    const client = clientFor(chainId);
    const ids = (await client.readContract({
      address: registry as `0x${string}`,
      abi: templateRegistryAbi,
      functionName: "getTemplatesByCreator",
      args: [address as `0x${string}`],
    })) as bigint[];
    if (!ids || ids.length === 0) return { published: 0, deploys: 0 };

    // One call for every template's deploy count, then index by id: cheaper
    // than a getTemplate per id, which would also drag the full source back.
    const summaries = (await client.readContract({
      address: registry as `0x${string}`,
      abi: templateRegistryAbi,
      functionName: "listSummaries",
      args: [BigInt(0), BigInt(MAX_TEMPLATE_SCAN)],
    })) as [bigint[], string[], bigint[], bigint[], boolean[], string[]];

    const countById = new Map<string, number>();
    summaries[0].forEach((id, i) => countById.set(id.toString(), Number(summaries[3][i])));
    let deploys = 0;
    for (const id of ids) deploys += countById.get(id.toString()) ?? 0;
    return { published: ids.length, deploys };
  } catch {
    return null;
  }
}

const addressInput = z.object({
  chainId: z.number().int().positive(),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

interface RawDeployment {
  contractAddress: string;
  templateId: string;
  projectName: string;
  network: string;
  deployedAt: bigint;
  txHash: string;
}

/** Source-verification status for one contract, straight from Blockscout.
 *  Returns null, not false, when the explorer could not answer, so an
 *  unreachable explorer never reads as "this contract is unverified". */
async function verifiedOnExplorer(chainId: number, address: string): Promise<boolean | null> {
  try {
    const base = chainConfig(chainId).explorerUrl;
    const resp = await fetchExplorer(`${base}/api/v2/smart-contracts/${address}`);
    if (resp.status === 404) return false;
    if (!resp.ok) return null;
    const json = (await resp.json()) as { is_verified?: boolean };
    return json.is_verified === true;
  } catch {
    return null;
  }
}

/** A developer's deployments and reputation on one chain. Plain so other server
 *  code (the builder overview) can call it directly. */
export async function readDeployerProfile(data: { chainId: number; address: string }) {
  const registry = projectRegistryAddress(data.chainId);
  if (!isContractConfigured(registry)) {
    // No registry on this chain: say so rather than reporting an empty
    // profile, which would read as "this developer has done nothing".
    return { available: false as const, reason: "no_registry" as const };
  }

  let raw: RawDeployment[] = [];
  try {
    const result = await clientFor(data.chainId).readContract({
      address: registry as `0x${string}`,
      abi: projectRegistryAbi,
      functionName: "getDeployments",
      args: [data.address as `0x${string}`],
    });
    raw = (result as RawDeployment[]) ?? [];
  } catch {
    return { available: false as const, reason: "unreachable" as const };
  }

  const deployments: DeploymentLike[] = raw.map((d) => ({
    contractAddress: d.contractAddress,
    templateId: d.templateId,
    projectName: d.projectName,
    network: d.network,
    // The registry stores seconds; the app's convention is milliseconds.
    deployedAt: Number(d.deployedAt) * 1000,
    txHash: d.txHash,
  }));

  const credit = await templateCredit(data.chainId, data.address);
  const sample = deployments.slice(0, MAX_VERIFICATION_CHECKS);
  const checks = await Promise.all(
    sample.map((d) => verifiedOnExplorer(data.chainId, d.contractAddress)),
  );
  // If the explorer answered for nothing at all, treat verification as
  // unknown rather than reporting a rate of zero.
  const answered = checks.some((c) => c !== null);
  const verifiedSet = answered
    ? new Set(
        sample.filter((_, i) => checks[i] === true).map((d) => d.contractAddress.toLowerCase()),
      )
    : null;

  return {
    available: true as const,
    address: data.address.toLowerCase(),
    chainId: data.chainId,
    reputation: deriveReputation(sample, verifiedSet, credit),
    /** False when this chain has no template marketplace, or it could not be
     *  read. deriveReputation folds that into 0, which would otherwise read
     *  as "this developer has published nothing". */
    templatesAvailable: credit !== null,
    /** True when more contracts exist than were checked, so the UI can say
     *  the rate is over a sample rather than the whole history. */
    sampled: deployments.length > sample.length,
    totalDeployments: deployments.length,
    /** Lowercased addresses the explorer reported as verified, or null when it
     *  could not answer. */
    verifiedAddresses: verifiedSet ? [...verifiedSet] : null,
    deployments: deployments.slice(0, 100),
  };
}

export const getDeployerProfile = createServerFn({ method: "GET" })
  .inputValidator(addressInput)
  .handler(({ data }) => readDeployerProfile(data));

const leaderboardInput = z.object({
  chainId: z.number().int().positive(),
  limit: z.number().int().min(1).max(100).default(25),
});

// --- The builder leaderboard -------------------------------------------------
//
// Every source is read on its own and may fail on its own. A source that is not
// deployed on the chain contributes nothing; a source that did not answer is
// named in `missing`, so the page can say what the ranks leave out instead of
// silently ranking on less. The formula lives in src/lib/leaderboard.ts.

export type Leaderboard =
  | { available: true; chainId: number; entries: BoardEntry[]; missing: Activity[] }
  | { available: false; reason: "unreachable"; entries: BoardEntry[] };

/** Successful recordDeployment calls per wallet. `{}` when there is no
 *  registry on the chain; null when the explorer did not answer. */
async function contractCounts(chainId: number): Promise<Record<string, number> | null> {
  const registry = projectRegistryAddress(chainId);
  if (!isContractConfigured(registry)) return {};
  try {
    const api = chainConfig(chainId).explorerApiUrl;
    const url = `${api}?module=account&action=txlist&address=${registry}&sort=asc`;
    const resp = await fetchExplorer(url);
    const json = (await resp.json()) as {
      result?: Array<{ to?: string; from: string; input?: string; isError?: string }> | string;
    };
    if (!Array.isArray(json.result)) return null;
    const counts: Record<string, number> = {};
    for (const t of json.result) {
      // Only successful calls to recordDeployment on the registry count. A
      // reverted tx is not a deployment, and counting it would let anyone
      // inflate their rank with failed transactions.
      if (t.to?.toLowerCase() !== registry.toLowerCase()) continue;
      if (!(t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR)) continue;
      if (t.isError !== "0") continue;
      const from = t.from.toLowerCase();
      counts[from] = (counts[from] ?? 0) + 1;
    }
    return counts;
  } catch {
    return null;
  }
}

interface MarketRow {
  id: number;
  creator: string;
  sales: number;
  deploys: number;
  active: boolean;
  hidden: boolean;
}

/** DevStationMarketplace listings, and the wallets that run it (owner and
 *  treasury), which are DevStation rather than a builder. */
async function marketRows(chainId: number): Promise<{ rows: MarketRow[]; house: string[] } | null> {
  const contract = marketplaceAddress(chainId);
  if (!isContractConfigured(contract)) return { rows: [], house: [] };
  try {
    const client = clientFor(chainId);
    const read = { address: contract, abi: devStationMarketplaceAbi } as const;
    const [page, owner, treasury] = await Promise.all([
      client.readContract({ ...read, functionName: "listSummaries", args: [0n, 500n] }),
      client.readContract({ ...read, functionName: "owner" }),
      client.readContract({ ...read, functionName: "treasury" }),
    ]);
    return {
      rows: page.map((row) => ({
        id: Number(row.id),
        creator: row.creator.toLowerCase(),
        sales: Number(row.sales),
        deploys: Number(row.deploys),
        active: row.active,
        hidden: row.hidden,
      })),
      house: [owner.toLowerCase(), treasury.toLowerCase()],
    };
  } catch {
    return null;
  }
}

interface TemplateRow {
  id: number;
  creator: string;
  deployCount: number;
  active: boolean;
}

/** The older TemplateRegistry's listings, and its treasury. */
async function templateRows(
  chainId: number,
): Promise<{ rows: TemplateRow[]; house: string[] } | null> {
  const registry = templateRegistryAddress(chainId);
  if (!isContractConfigured(registry)) return { rows: [], house: [] };
  try {
    const client = clientFor(chainId);
    const read = { address: registry, abi: templateRegistryAbi } as const;
    const [[ids, creators, , deployCounts, actives], treasury] = await Promise.all([
      client.readContract({
        ...read,
        functionName: "listSummaries",
        args: [0n, BigInt(MAX_TEMPLATE_SCAN)],
      }),
      client.readContract({ ...read, functionName: "protocolTreasury" }),
    ]);
    return {
      rows: ids.map((id, i) => ({
        id: Number(id),
        creator: creators[i].toLowerCase(),
        deployCount: Number(deployCounts[i]),
        active: actives[i],
      })),
      house: [treasury.toLowerCase()],
    };
  } catch {
    return null;
  }
}

async function buildLeaderboard(data: { chainId: number; limit: number }): Promise<Leaderboard> {
  const [{ marketplaceEvents }, { readListingActivity, readPublishedAppCounts }] =
    await Promise.all([
      import("@/lib/api/marketplace-logs.server"),
      import("@/lib/api/marketplace-activity.server"),
    ]);
  const [contracts, apps, market, templates, purchased, deployed, tipped, activity] =
    await Promise.all([
      contractCounts(data.chainId),
      readPublishedAppCounts(),
      marketRows(data.chainId),
      templateRows(data.chainId),
      marketplaceEvents(data.chainId, "Purchased"),
      marketplaceEvents(data.chainId, "DeployRecorded"),
      marketplaceEvents(data.chainId, "Tipped"),
      readListingActivity(),
    ]);

  const marketLive = isContractConfigured(marketplaceAddress(data.chainId));
  const sources: unknown[] = [contracts, apps, market, templates, activity];
  if (marketLive) sources.push(purchased, deployed, tipped);
  if (sources.every((s) => s === null)) {
    return { available: false, reason: "unreachable", entries: [] };
  }

  const tally = new Tally();
  for (const [wallet, n] of Object.entries(contracts ?? {})) tally.add(wallet, "contracts", n);
  for (const [wallet, n] of Object.entries(apps ?? {})) tally.add(wallet, "apps", n);

  // Listing id -> creator, for crediting clones. Hidden listings were taken
  // down by moderation and earn nothing.
  const creatorOf = new Map<string, string>();
  const shown = new Set<number>();
  for (const row of market?.rows ?? []) {
    if (row.hidden) continue;
    shown.add(row.id);
    creatorOf.set(`m-${row.id}`, row.creator);
    if (row.active) tally.add(row.creator, "listings");
  }
  for (const row of templates?.rows ?? []) {
    creatorOf.set(`t-${row.id}`, row.creator);
    if (row.active) tally.add(row.creator, "listings");
    tally.add(row.creator, "deploys", row.deployCount);
  }

  // What someone else chose. A creator buying, deploying or tipping their own
  // listing is not counted; the events say who did it, the summaries do not,
  // so the summaries are only the fallback when the explorer is down.
  const byOthers = (e: { id: number; actor: string; creator: string }) =>
    shown.has(e.id) && e.actor !== e.creator;
  if (purchased) {
    for (const e of purchased) if (byOthers(e)) tally.add(e.creator, "sales");
  } else {
    for (const row of market?.rows ?? [])
      if (!row.hidden) tally.add(row.creator, "sales", row.sales);
  }
  if (deployed) {
    for (const e of deployed) if (byOthers(e)) tally.add(e.creator, "deploys");
  } else {
    for (const row of market?.rows ?? []) {
      if (!row.hidden) tally.add(row.creator, "deploys", row.deploys);
    }
  }
  for (const e of tipped ?? []) if (byOthers(e)) tally.add(e.creator, "tips");

  // Official DevStation listings (b-…) have no creator to credit.
  for (const [id, counts] of Object.entries(activity ?? {})) {
    const creator = creatorOf.get(id);
    if (creator) tally.add(creator, "clones", counts.clone + counts.download);
  }

  const counted = tally.counts();
  for (const wallet of [...(market?.house ?? []), ...(templates?.house ?? [])]) {
    delete counted[wallet];
  }

  const missing: Activity[] = [];
  if (contracts === null) missing.push("contracts");
  if (apps === null) missing.push("apps");
  if (market === null || templates === null) missing.push("listings");
  if (marketLive && purchased === null && market === null) missing.push("sales");
  if (templates === null || (marketLive && deployed === null && market === null)) {
    missing.push("deploys");
  }
  if (marketLive && tipped === null) missing.push("tips");
  if (activity === null) missing.push("clones");

  return {
    available: true,
    chainId: data.chainId,
    entries: rankBuilders(counted, data.limit),
    missing,
  };
}

const BOARD_CACHE_MS = 60_000;
const boards = new Map<string, { at: number; value: Leaderboard }>();

/** The builder leaderboard for one chain, cached for a minute: it reads the
 *  explorer, two contracts and the runner, and the page does not need it fresher. */
export async function readLeaderboard(data: { chainId: number; limit: number }) {
  const key = `${data.chainId}:${data.limit}`;
  const hit = boards.get(key);
  if (hit && Date.now() - hit.at < BOARD_CACHE_MS) return hit.value;
  const value = await buildLeaderboard(data);
  if (value.available) boards.set(key, { at: Date.now(), value });
  return value;
}

export const getLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(leaderboardInput)
  .handler(({ data }) => readLeaderboard(data));
