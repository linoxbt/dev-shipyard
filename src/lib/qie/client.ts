// Assembling a wallet's QIE identity from the sources that actually carry it.
//
// Two places, because neither has the whole answer:
//   • the QIE ID contract: how many names the wallet holds and which tokens,
//                          which is the proof of ownership
//   • the explorer       : the registration that minted each token, whose
//                          calldata carries the label, and the wallet's first
//                          activity for its age
//
// Everything degrades: a failed explorer call costs the labels but not the
// count, and a wallet with no names is a real answer rather than an error.

import {
  decodeRegistrationStrings,
  labelsFromStrings,
  matchNamesToTokens,
  type QieIdentity,
  type ResolvedName,
} from "./identity";

/** Names indexed per wallet. The count from balanceOf remains exact
 *  regardless, so a wallet holding more than this shows an accurate total with
 *  a subset of labels. */
export const MAX_NAMES_INDEXED = 24;

export interface IdentitySources {
  /** balanceOf: the authoritative count. */
  nameCount: () => Promise<number>;
  /** tokenOfOwnerByIndex for index 0..count-1: the tokens the wallet owns now. */
  tokenIds: (count: number) => Promise<string[]>;
  /** The transaction that minted a token. */
  mintTx: (tokenId: string) => Promise<string | null>;
  /** Every QIE ID token a transaction minted, in mint order. */
  mintedIn: (txHash: string) => Promise<string[]>;
  /** Raw calldata of a registration transaction. */
  txInput: (txHash: string) => Promise<string | null>;
  /** Timestamp of the wallet's first activity, ms. */
  firstSeenAt: () => Promise<number | null>;
}

/**
 * Resolve the `.qie` names a wallet holds.
 *
 * Starts from the contract's own list of the wallet's tokens, so every name
 * returned is owned right now: that is the proof, and it covers names received
 * by transfer as well as names the wallet registered itself. Labels come from
 * the registration that minted each token.
 */
export async function resolveNames(
  count: number,
  sources: IdentitySources,
): Promise<ResolvedName[]> {
  if (count <= 0) return [];
  const owned = await sources.tokenIds(Math.min(count, MAX_NAMES_INDEXED)).catch(() => []);
  if (owned.length === 0) return [];
  const ownedSet = new Set(owned);

  // Waves of parallel requests rather than a serial chain: a wallet with a
  // dozen names would otherwise wait on dozens of round-trips one after another.
  const mints = await Promise.all(owned.map((id) => sources.mintTx(id).catch(() => null)));
  const txs = [...new Set(mints.filter((tx): tx is string => !!tx))];

  const registrations = await Promise.all(
    txs.map(async (txHash) => {
      const [input, minted] = await Promise.all([
        sources.txInput(txHash).catch(() => null),
        sources.mintedIn(txHash).catch(() => [] as string[]),
      ]);
      return { txHash, input, minted };
    }),
  );

  const byToken = new Map<string, ResolvedName>();
  for (const { txHash, input, minted } of registrations) {
    if (!input || minted.length === 0) continue;
    const labels = labelsFromStrings(decodeRegistrationStrings(input));
    // Matched against everything the registration minted, not just this
    // wallet's tokens: a registration can mint names to several wallets, and
    // position only lines up against the full list.
    for (const name of matchNamesToTokens(labels, minted, txHash)) {
      if (ownedSet.has(name.tokenId)) byToken.set(name.tokenId, name);
    }
  }
  // The contract's enumeration order, so the first name is stable for every
  // viewer rather than depending on which explorer call answered first.
  return owned.map((id) => byToken.get(id)).filter((n): n is ResolvedName => !!n);
}

/** Everything DevStation can say about a wallet, from real sources only. */
export async function loadIdentity(
  address: string,
  sources: IdentitySources,
): Promise<QieIdentity> {
  const [nameCount, firstSeenAt] = await Promise.all([
    sources.nameCount().catch(() => 0),
    sources.firstSeenAt().catch(() => null),
  ]);
  const names = await resolveNames(nameCount, sources).catch(() => [] as ResolvedName[]);

  return {
    address,
    names,
    nameCount,
    firstSeenAt,
    walletAgeMs: firstSeenAt === null ? null : Math.max(0, Date.now() - firstSeenAt),
  };
}
