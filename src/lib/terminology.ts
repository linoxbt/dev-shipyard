// QIE-native terminology.
//
// QIE is EVM-equivalent, so under the hood everything here is plain ERC-20 /
// ERC-721 / ERC-1155 — and it MUST stay that way in the code we generate, the
// ABIs we parse and the sources we verify. What changes is only what a
// developer READS while a QIE chain is selected: "QIE-20 Token" rather than
// "ERC-20 Token", so the product reinforces the ecosystem it belongs to.
//
// Important context, so nobody later "corrects" this into something it isn't:
// QIE does NOT publish a QIE-20 / QIE-721 standard. Its own docs say
// ERC-20/721/1155 and its explorer labels tokens that way. This naming is
// DevStation's, which is exactly why `technicalStandard()` exists and why
// every details panel shows the real ERC name alongside — a developer must
// always be one glance away from a term they can search real documentation
// for. Never present QIE-20 as a distinct on-chain standard.
//
// Deliberately a plain module, not a hook: the explorer resolves its chain
// from the URL rather than the globally selected network, and non-React code
// (the AI agent loop, server functions) needs the same vocabulary. Every
// function therefore takes an explicit chainId. `useTerminology()` at the
// bottom is a thin convenience for components on the selected chain.

import { isQieChain } from "@/lib/chains";
import { useActiveChain } from "@/hooks/useActiveChain";

/** Canonical EVM token standards we rename for display. Keys are matched
 *  case-insensitively and with the hyphen optional, because Blockscout
 *  returns "ERC-20" while ABIs and our own copy use "ERC20". */
const QIE_STANDARD_NAMES: Record<string, string> = {
  erc20: "QIE-20",
  erc721: "QIE-721",
  erc1155: "QIE-1155",
};

function normalizeStandard(standard: string): string {
  return standard.toLowerCase().replace(/[\s-]/g, "");
}

/**
 * Display name for a token standard on a given chain.
 * "ERC-20" → "QIE-20" on QIE; unchanged on BOT Chain and anything else.
 * Unknown values pass through untouched, so a new Blockscout token type never
 * renders as blank.
 */
export function tokenStandard(standard: string, chainId: number): string {
  if (!standard) return standard;
  if (!isQieChain(chainId)) return standard;
  return QIE_STANDARD_NAMES[normalizeStandard(standard)] ?? standard;
}

/**
 * The real EVM standard, always — for technical details panels, tooltips,
 * generated NatSpec and docs links. Normalises "ERC20" to "ERC-20" so the
 * spelling is consistent wherever it is shown next to a QIE-native name.
 */
export function technicalStandard(standard: string): string {
  if (!standard) return standard;
  const n = normalizeStandard(standard);
  const m = /^erc(\d+)$/.exec(n);
  return m ? `ERC-${m[1]}` : standard;
}

/**
 * Both names together, for the one place a developer needs to connect them:
 * "QIE-20 (ERC-20)" on QIE, plain "ERC-20" elsewhere. Returns a single string
 * rather than JSX so it works in titles, option labels and alt text too.
 */
export function tokenStandardWithTechnical(standard: string, chainId: number): string {
  const display = tokenStandard(standard, chainId);
  const technical = technicalStandard(standard);
  return display === technical ? display : `${display} (${technical})`;
}

// Single-pass substitution over prose. Alternation is ordered longest-first so
// "ERC-1155" can never be partially matched by a shorter pattern, and one pass
// means an already-substituted "QIE NFT" cannot be re-matched into
// "QIE QIE NFT". \b guards stop "NFT" matching inside a longer word.
const PROSE_PATTERN = /\bERC-?1155\b|\bERC-?721\b|\bERC-?20\b|\bNFTs\b|\bNFT\b/g;

const PROSE_REPLACEMENTS: Record<string, string> = {
  erc1155: "QIE-1155",
  erc721: "QIE-721",
  erc20: "QIE-20",
  nft: "QIE NFT",
  nfts: "QIE NFTs",
};

/**
 * Rewrite EVM standard names inside a sentence for display.
 *
 * Source copy is always stored in NEUTRAL form ("a standard ERC-20 token"),
 * which is what actually renders off QIE. On a QIE chain this swaps in the
 * QIE-native names. Storing the neutral form and substituting — rather than
 * hardcoding "QIE-20" into the data — is what keeps BOT Chain correct; a
 * static QIE string would leak onto every chain.
 */
export function applyTerminology(text: string, chainId: number): string {
  if (!text || !isQieChain(chainId)) return text;
  return text.replace(PROSE_PATTERN, (match) => {
    const key = match.toLowerCase().replace(/-/g, "");
    return PROSE_REPLACEMENTS[key] ?? match;
  });
}

/** "QIE NFT" on QIE, "NFT" elsewhere. */
export function nftNoun(chainId: number): string {
  return isQieChain(chainId) ? "QIE NFT" : "NFT";
}

/** "QIE Contract" on QIE, "Contract" elsewhere. */
export function contractNoun(chainId: number): string {
  return isQieChain(chainId) ? "QIE Contract" : "Contract";
}

/** "QIE Gas" on QIE, "<SYMBOL> Gas" elsewhere (e.g. "BOT Gas"). */
export function gasNoun(chainId: number, nativeTokenSymbol: string): string {
  return isQieChain(chainId) ? "QIE Gas" : `${nativeTokenSymbol} Gas`;
}

/**
 * Convenience hook for components rendering on the *selected* network.
 * Components driven by a route param (the explorer) must call the plain
 * functions with `chainIdForSlug(...)` instead — the selected chain and the
 * chain being browsed are not always the same.
 */
export function useTerminology() {
  const { chainId } = useActiveChain();
  return {
    chainId,
    isQie: isQieChain(chainId),
    tokenStandard: (s: string) => tokenStandard(s, chainId),
    applyTerminology: (text: string) => applyTerminology(text, chainId),
    /** Short alias for applyTerminology, for inline use in JSX. */
    t: (text: string) => applyTerminology(text, chainId),
    tokenStandardWithTechnical: (s: string) => tokenStandardWithTechnical(s, chainId),
    technicalStandard,
    nftNoun: () => nftNoun(chainId),
    contractNoun: () => contractNoun(chainId),
  };
}
