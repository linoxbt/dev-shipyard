import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createPublicClient, http } from "viem";
import { SUPPORTED_CHAINS, chainConfig, qieTestnet } from "@/lib/chains";
import { projectRegistryAbi } from "@/lib/abis/projectRegistry";
import {
  projectRegistryAddress,
  templateRegistryAddress,
  isContractConfigured,
} from "@/lib/contracts";
import { templateRegistryAbi } from "@/lib/abis/templateRegistry";
import {
  deriveReputation,
  rankDeployers,
  type DeploymentLike,
  type TemplateCredit,
} from "@/lib/reputation";
import { fetchExplorer } from "@/lib/api/explorer-fetch";

// Developer profiles and the leaderboard, derived from on-chain facts only.
//
// Nothing here is self-reported. A profile is what ProjectRegistry says the
// wallet deployed, plus what the explorer says about those contracts' source
// verification. A developer cannot raise their own standing by editing a field,
// which is the whole point — a reputation you can type in is worthless.
//
// There is no database. The Phase 4 sketch assumed one would index deployers
// for the leaderboard; instead the leaderboard is rebuilt from the explorer's
// indexed tx list, the same source getEcosystemStats already uses for unique
// wallets. ProjectRegistry deliberately exposes no way to enumerate deployers
// (getDeployments takes an address), so the addresses must come from the
// recordDeployment transactions themselves.

function clientFor(chainId: number) {
  const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId) ?? qieTestnet;
  return createPublicClient({ chain, transport: http() });
}

const RECORD_DEPLOYMENT_SELECTOR = "0x4311b312"; // recordDeployment(address,string,string,string,string)

/** How many contracts to ask the explorer about per profile. Verification is
 *  one request per contract, so a prolific deployer would otherwise fan out
 *  into hundreds — the rate is computed over this sample and says so. */
const MAX_VERIFICATION_CHECKS = 40;

/** How many templates to scan when summing a creator's deploys. The registry
 *  has no per-creator aggregate, so the summaries have to be read and filtered.
 *  Well above any realistic count today; if the marketplace ever outgrows it,
 *  page rather than raise it. */
const MAX_TEMPLATE_SCAN = 200;

/** Templates this developer published, and how often others deployed them.
 *
 *  Returns null when there is no registry on the chain or it cannot be read —
 *  so "no marketplace here" never renders as "published nothing". */
async function templateCredit(chainId: number, address: string): Promise<TemplateCredit | null> {
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

    // One call for every template's deploy count, then index by id — cheaper
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
 *  Returns null — not false — when the explorer could not answer, so an
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

export const getDeployerProfile = createServerFn({ method: "GET" })
  .inputValidator(addressInput)
  .handler(async ({ data }) => {
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
      deployments: deployments.slice(0, 100),
    };
  });

const leaderboardInput = z.object({
  chainId: z.number().int().positive(),
  limit: z.number().int().min(1).max(100).default(25),
});

export const getLeaderboard = createServerFn({ method: "GET" })
  .inputValidator(leaderboardInput)
  .handler(async ({ data }) => {
    const registry = projectRegistryAddress(data.chainId);
    if (!isContractConfigured(registry)) {
      return { available: false as const, reason: "no_registry" as const, entries: [] };
    }
    try {
      const api = chainConfig(data.chainId).explorerApiUrl;
      const url = `${api}?module=account&action=txlist&address=${registry}&sort=asc`;
      const resp = await fetchExplorer(url);
      const json = (await resp.json()) as {
        result?: Array<{ to?: string; from: string; input?: string; isError?: string }>;
      };
      const txs = Array.isArray(json.result) ? json.result : [];
      const counts: Record<string, number> = {};
      for (const t of txs) {
        // Only successful calls to recordDeployment on the registry count. A
        // reverted tx is not a deployment, and counting it would let anyone
        // inflate their rank with failed transactions.
        if (t.to?.toLowerCase() !== registry.toLowerCase()) continue;
        if (!(t.input ?? "").startsWith(RECORD_DEPLOYMENT_SELECTOR)) continue;
        if (t.isError !== "0") continue;
        const from = t.from.toLowerCase();
        counts[from] = (counts[from] ?? 0) + 1;
      }
      return {
        available: true as const,
        chainId: data.chainId,
        entries: rankDeployers(counts, data.limit),
      };
    } catch {
      return { available: false as const, reason: "unreachable" as const, entries: [] };
    }
  });
