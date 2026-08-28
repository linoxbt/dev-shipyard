// Canonical category vocabulary for the onchain ContractLabelRegistry.
//
// There were three different vocabularies in play: the registry's own filter
// list ("Token", "Infrastructure", "Gaming"…), the template catalogue's
// TemplateCategory ("Token Standards", "Utility", "Custom"…), and whatever
// string the AI agent chose to emit. Both the deploy wizard and the agent
// wrote the TEMPLATE vocabulary onchain, so a label saved as "Token Standards"
// could never match the registry's "Token" filter, and "Utility"/"Custom"
// matched nothing at all — labels DevStation wrote were unfindable in
// DevStation's own registry UI.
//
// This module is the single source of truth. The category written onchain is
// always one of LABEL_CATEGORIES, whatever the caller started from.

import type { TemplateCategory } from "@/lib/data/templates";

/** Categories the label registry UI filters by. Written onchain, so treat
 *  these strings as a stable data contract — renaming one orphans every label
 *  already saved under the old name. */
export const LABEL_CATEGORIES = [
  "Token",
  "NFT",
  "DeFi",
  "Governance",
  "Infrastructure",
  "Gaming",
  "Identity",
  "Other",
] as const;

export type LabelCategory = (typeof LABEL_CATEGORIES)[number];

const DEFAULT_CATEGORY: LabelCategory = "Other";

/** Template catalogue vocabulary -> registry vocabulary. */
const FROM_TEMPLATE: Record<TemplateCategory, LabelCategory> = {
  "Token Standards": "Token",
  NFT: "NFT",
  DeFi: "DeFi",
  Governance: "Governance",
  Utility: "Infrastructure",
  Custom: "Other",
};

export function labelCategoryForTemplate(category: TemplateCategory): LabelCategory {
  return FROM_TEMPLATE[category] ?? DEFAULT_CATEGORY;
}

/** Aliases for the free-text a model might produce. Keys are compared
 *  lowercased with punctuation stripped, so "token-standards", "ERC20" and
 *  "Token Standards" all land on "Token". */
const ALIASES: Record<string, LabelCategory> = {
  token: "Token",
  tokens: "Token",
  tokenstandards: "Token",
  tokenstandard: "Token",
  erc20: "Token",
  qie20: "Token",
  fungible: "Token",
  stablecoin: "Token",
  nft: "NFT",
  nfts: "NFT",
  erc721: "NFT",
  qie721: "NFT",
  erc1155: "NFT",
  collectible: "NFT",
  collectibles: "NFT",
  defi: "DeFi",
  staking: "DeFi",
  vesting: "DeFi",
  lending: "DeFi",
  swap: "DeFi",
  dex: "DeFi",
  governance: "Governance",
  dao: "Governance",
  multisig: "Governance",
  timelock: "Governance",
  voting: "Governance",
  infrastructure: "Infrastructure",
  infra: "Infrastructure",
  utility: "Infrastructure",
  registry: "Infrastructure",
  oracle: "Infrastructure",
  proxy: "Infrastructure",
  gaming: "Gaming",
  game: "Gaming",
  games: "Gaming",
  identity: "Identity",
  did: "Identity",
  soulbound: "Identity",
  sbt: "Identity",
  custom: "Other",
  other: "Other",
};

/**
 * Coerce arbitrary caller input to a valid registry category.
 *
 * The agent emits free text, and that string goes onchain where it cannot be
 * corrected later — so normalise before writing rather than validating after.
 * Unknown input falls back to "Other", which is a real filterable category,
 * instead of an orphan string nothing can find.
 */
export function normalizeLabelCategory(input: string | undefined | null): LabelCategory {
  if (!input) return DEFAULT_CATEGORY;
  const key = input.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key) return DEFAULT_CATEGORY;
  const exact = LABEL_CATEGORIES.find((c) => c.toLowerCase() === input.trim().toLowerCase());
  if (exact) return exact;
  return ALIASES[key] ?? DEFAULT_CATEGORY;
}
