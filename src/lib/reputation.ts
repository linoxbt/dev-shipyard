// Developer reputation, derived from what is actually on chain.
//
// No new contract and no score anyone can mint: everything here is computed
// from the deployments the ProjectRegistry already records: the same data the
// Projects page reads. A number nobody can inflate by clicking is worth more
// than a badge that can be, so this deliberately measures only things that
// cost gas to create.
//
// It is a summary of verifiable history, not a ranking. There is no global
// leaderboard, because the registry is per-deployer and a leaderboard would
// need an indexer this app does not have.

export interface DeploymentLike {
  contractAddress: string;
  templateId: string;
  projectName: string;
  network: string;
  /** Milliseconds. The registry stores seconds, but useProjectRegistry
   *  normalises to ms on the way in, so that is the app's convention and the
   *  one this follows: converting here as well would double-scale it. */
  deployedAt: number | bigint;
  txHash: string;
}

export type Tier = "newcomer" | "builder" | "regular" | "veteran";

export interface Reputation {
  deployments: number;
  /** Distinct chains deployed to. Breadth, not just volume. */
  networks: string[];
  /** Distinct templates used: a proxy for range. */
  templates: string[];
  /** Milliseconds. */
  firstAt: number | null;
  lastAt: number | null;
  /** Whole days between the first and last deployment. */
  activeDays: number;
  /** Contracts whose source is verified on the explorer. */
  verified: number;
  /** Templates this developer has published to the marketplace. */
  templatesPublished: number;
  /** Times OTHER people deployed this developer's templates.
   *
   *  The strongest reputation signal here, because it is the only one that
   *  requires someone else to act: publishing costs a transaction and proves
   *  nothing, but a template others reach for has demonstrated its worth. */
  templateDeploys: number;
  /** Share of deployments that are source-verified, 0-1.
   *
   *  NULL when verification could not be established: the explorer was
   *  unreachable, or nobody asked. That is deliberately distinct from 0: "we
   *  do not know" and "none are verified" are different claims about a
   *  developer, and showing the second when the first is true is a lie. */
  verificationRate: number | null;
  tier: Tier;
}

const TIERS: Array<{ tier: Tier; min: number }> = [
  { tier: "veteran", min: 25 },
  { tier: "regular", min: 10 },
  { tier: "builder", min: 3 },
  { tier: "newcomer", min: 0 },
];

/** Tier from deployment volume, with template authorship counted alongside it.
 *
 *  A deploy of someone else's template and a deploy of your own are the same
 *  amount of work; having written something others reach for is not. Each
 *  third-party deploy of your template counts as one, so a template nobody uses
 *  adds nothing, which is the point. */
export function tierFor(deployments: number, templateDeploys = 0): Tier {
  const weight = deployments + templateDeploys;
  return TIERS.find((t) => weight >= t.min)?.tier ?? "newcomer";
}

export const TIER_LABEL: Record<Tier, string> = {
  newcomer: "Newcomer",
  builder: "Builder",
  regular: "Regular",
  veteran: "Veteran",
};

/** viem returns uint256 as bigint; Number() on it keeps the value usable
 *  for arithmetic here, where the magnitudes are timestamps, not wei. */
function toNumber(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

/** Summarise a wallet's on-chain deployment history. */
/** Reputation from on-chain facts alone.
 *
 *  `verifiedAddresses` is the set of this developer's contracts the explorer
 *  reports as source-verified. Pass null when that could not be checked -
 *  verificationRate then reports null rather than implying zero. */
export interface TemplateCredit {
  /** Templates published by this developer. */
  published: number;
  /** Total deploys recorded against those templates. */
  deploys: number;
}

export function deriveReputation(
  deployments: DeploymentLike[],
  verifiedAddresses?: Set<string> | null,
  templates?: TemplateCredit | null,
): Reputation {
  const times = deployments
    .map((d) => toNumber(d.deployedAt))
    // A zero timestamp means the row carries no time; treating it as 1970
    // would make every developer look decades old.
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => a - b);

  const firstAt = times[0] ?? null;
  const lastAt = times[times.length - 1] ?? null;

  const verified =
    verifiedAddresses == null
      ? 0
      : deployments.filter((d) => verifiedAddresses.has(d.contractAddress.toLowerCase())).length;

  return {
    deployments: deployments.length,
    networks: [...new Set(deployments.map((d) => d.network).filter(Boolean))].sort(),
    templates: [...new Set(deployments.map((d) => d.templateId).filter(Boolean))].sort(),
    firstAt,
    lastAt,
    activeDays:
      firstAt !== null && lastAt !== null ? Math.floor((lastAt - firstAt) / 86_400_000) : 0,
    templatesPublished: templates?.published ?? 0,
    templateDeploys: templates?.deploys ?? 0,
    verified,
    verificationRate:
      verifiedAddresses == null || deployments.length === 0 ? null : verified / deployments.length,
    tier: tierFor(deployments.length, templates?.deploys ?? 0),
  };
}

/** One line a person can read, rather than a bare number. */
export function reputationSummary(r: Reputation): string {
  if (r.deployments === 0 && r.templatesPublished === 0) {
    return "No deployments recorded on chain yet.";
  }
  if (r.deployments === 0) {
    return `${r.templatesPublished} template${r.templatesPublished === 1 ? "" : "s"} published · used ${r.templateDeploys} time${r.templateDeploys === 1 ? "" : "s"}`;
  }
  const parts = [`${r.deployments} deployment${r.deployments === 1 ? "" : "s"}`];
  if (r.networks.length > 1) parts.push(`${r.networks.length} networks`);
  if (r.templates.length > 1) parts.push(`${r.templates.length} templates`);
  if (r.templatesPublished > 0) {
    parts.push(
      `${r.templatesPublished} template${r.templatesPublished === 1 ? "" : "s"} published`,
    );
  }
  if (r.templateDeploys > 0) {
    parts.push(`used ${r.templateDeploys} time${r.templateDeploys === 1 ? "" : "s"}`);
  }
  if (r.activeDays >= 1) parts.push(`active ${r.activeDays} day${r.activeDays === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export interface LeaderboardEntry {
  address: string;
  deployments: number;
  tier: Tier;
  /** 1-based, and SHARED by ties: two developers on 9 deploys are both 4th,
   *  and the next is 6th. Ranking ties arbitrarily by address would invent a
   *  difference the chain does not record. */
  rank: number;
}

/** Rank developers by deployment count.
 *
 *  Input is address -> count, which is what the explorer's indexed tx list
 *  yields (see getLeaderboard). There is no on-chain way to enumerate
 *  deployers: ProjectRegistry only exposes getDeployments(address), so the
 *  set of addresses has to come from the DeploymentRecorded txs themselves. */
export function rankDeployers(counts: Record<string, number>, limit = 50): LeaderboardEntry[] {
  const rows = Object.entries(counts)
    .filter(([address, n]) => /^0x[a-f0-9]{40}$/i.test(address) && n > 0)
    .map(([address, deployments]) => ({ address: address.toLowerCase(), deployments }))
    // Address is the tiebreak for ORDER only, so the list is stable between
    // renders; the rank number below still ties.
    .sort((a, b) => b.deployments - a.deployments || a.address.localeCompare(b.address));

  let rank = 0;
  let previous: number | null = null;
  return rows.slice(0, limit).map((row, i) => {
    if (previous === null || row.deployments < previous) {
      rank = i + 1;
      previous = row.deployments;
    }
    return { ...row, tier: tierFor(row.deployments), rank };
  });
}
