import { tierFor, TIER_LABEL, type Tier } from "@/lib/reputation";

// Achievements and progress, earned only from things that happened on chain or
// in the builder's own work. Every one names the fact it is measured by, and a
// locked one shows how far off it is, so nothing here is decoration.

export interface BuilderFacts {
  deployments: number;
  verified: number;
  networks: number;
  templatesUsed: number;
  /** Times other people deployed this builder's templates (legacy registry). */
  templateDeploys: number;
  listings: number;
  sales: number;
  paidDeploys: number;
  tipsReceived: number;
  appsBuilt: number;
  appsPublished: number;
  labels: number;
  qieNames: number;
  walletAgeDays: number | null;
  longestStreak: number;
  leaderboardRank: number | null;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  earned: boolean;
  current: number;
  target: number;
  group: "ship" | "quality" | "market" | "community" | "identity";
}

function goal(
  id: string,
  group: Achievement["group"],
  title: string,
  description: string,
  current: number,
  target: number,
): Achievement {
  return { id, group, title, description, current, target, earned: current >= target };
}

export function achievementsFor(f: BuilderFacts): Achievement[] {
  const rank = f.leaderboardRank;
  return [
    goal(
      "first-contract",
      "ship",
      "First contract",
      "Deploy a contract on chain.",
      f.deployments,
      1,
    ),
    goal("shipper", "ship", "Shipper", "Deploy 10 contracts.", f.deployments, 10),
    goal("veteran", "ship", "Veteran", "Deploy 25 contracts.", f.deployments, 25),
    goal("multichain", "ship", "Multichain", "Deploy on 2 or more networks.", f.networks, 2),
    goal("range", "ship", "Range", "Deploy from 5 different templates.", f.templatesUsed, 5),
    goal(
      "app-builder",
      "ship",
      "App builder",
      "Build an app with the Coding Agent.",
      f.appsBuilt,
      1,
    ),
    goal(
      "live",
      "ship",
      "Live on the web",
      "Publish an app to devstation.online.",
      f.appsPublished,
      1,
    ),
    goal("verified", "quality", "Verified", "Get a contract's source verified.", f.verified, 1),
    goal("open-book", "quality", "Open book", "Get 10 contracts verified.", f.verified, 10),
    goal("streak", "quality", "On a roll", "Stay active 7 days in a row.", f.longestStreak, 7),
    goal("seller", "market", "Seller", "List something in the Marketplace.", f.listings, 1),
    goal("first-sale", "market", "First sale", "Make a sale.", f.sales + f.paidDeploys, 1),
    goal("top-seller", "market", "Top seller", "Make 25 sales.", f.sales + f.paidDeploys, 25),
    goal(
      "adopted",
      "market",
      "Adopted",
      "Have others deploy your templates 10 times.",
      f.templateDeploys + f.paidDeploys,
      10,
    ),
    goal("tipped", "market", "Appreciated", "Receive a tip.", f.tipsReceived, 1),
    goal("labeler", "community", "Labeler", "Label 5 contracts in the registry.", f.labels, 5),
    goal(
      "top-ten",
      "community",
      "Top 10",
      "Reach the top 10 of the leaderboard.",
      rank !== null && rank <= 10 ? 1 : 0,
      1,
    ),
    goal("named", "identity", "Named", "Hold a .qie name.", f.qieNames, 1),
    goal("og", "identity", "OG", "Use a wallet that is a year old.", f.walletAgeDays ?? 0, 365),
  ];
}

const THRESHOLDS: Array<{ tier: Tier; min: number }> = [
  { tier: "newcomer", min: 0 },
  { tier: "builder", min: 3 },
  { tier: "regular", min: 10 },
  { tier: "veteran", min: 25 },
];

export interface TierProgress {
  tier: Tier;
  label: string;
  weight: number;
  next: { tier: Tier; label: string; needed: number; at: number } | null;
  /** 0-1 toward the next tier; 1 at the top. */
  progress: number;
}

/** Where a builder stands and what the next tier takes. Same weighting as
 *  reputation.ts: their own deployments plus deployments others made of their
 *  work. */
export function tierProgress(deployments: number, adoptedDeploys: number): TierProgress {
  const weight = deployments + adoptedDeploys;
  const tier = tierFor(deployments, adoptedDeploys);
  const index = THRESHOLDS.findIndex((t) => t.tier === tier);
  const nextStep = THRESHOLDS[index + 1];
  if (!nextStep) {
    return { tier, label: TIER_LABEL[tier], weight, next: null, progress: 1 };
  }
  const floor = THRESHOLDS[index].min;
  return {
    tier,
    label: TIER_LABEL[tier],
    weight,
    next: {
      tier: nextStep.tier,
      label: TIER_LABEL[nextStep.tier],
      needed: nextStep.min - weight,
      at: nextStep.min,
    },
    progress: Math.max(0, Math.min(1, (weight - floor) / (nextStep.min - floor))),
  };
}
