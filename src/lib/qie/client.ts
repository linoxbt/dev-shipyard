// Assembling a wallet's QIE identity from the sources that actually carry it.
//
// Three different places, because no single one has the answer:
//   • the NFT contract : how many names the wallet holds, and which token ids
//   • the explorer     : the registrations that carry the labels, and the
//                         wallet's first transaction for its age
//   • QIE's partner API: verification status, and only after consent
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

/** Names indexed per wallet. Raised now that resolution runs in parallel; the
 *  count from balanceOf remains exact regardless, so a wallet holding more
 *  than this shows an accurate total with a subset of labels. */
const MAX_NAMES_INDEXED = 24;

export interface ExplorerTransfer {
  txHash: string;
  tokenId: string;
}

export interface IdentitySources {
  /** balanceOf: the authoritative count. */
  nameCount: () => Promise<number>;
  /** Mint transfers of `.qie` tokens into this wallet, newest first. */
  transfers: (limit: number) => Promise<ExplorerTransfer[]>;
  /** Raw calldata of a registration transaction. */
  txInput: (txHash: string) => Promise<string | null>;
  /** Current owner of a token id, for proving the wallet still holds it. */
  ownerOf: (tokenId: string) => Promise<string | null>;
  /** Timestamp of the wallet's first transaction, ms. */
  firstSeenAt: () => Promise<number | null>;
}

/**
 * Resolve the `.qie` names a wallet provably holds.
 *
 * The label comes from the registration transaction; the claim is only made
 * once the wallet is confirmed to still own that exact token. Selling a name
 * therefore removes it from the profile, which is the point: otherwise a
 * profile would keep asserting an identity its owner had given away.
 */
export async function resolveNames(
  address: string,
  sources: IdentitySources,
): Promise<ResolvedName[]> {
  const transfers = await sources.transfers(MAX_NAMES_INDEXED).catch(() => []);
  if (transfers.length === 0) return [];

  // One registration can mint several names, so group by transaction before
  // matching labels to tokens.
  const byTx = new Map<string, string[]>();
  for (const t of transfers) {
    byTx.set(t.txHash, [...(byTx.get(t.txHash) ?? []), t.tokenId]);
  }

  // Two waves of parallel requests rather than a chain of serial ones. Done
  // one at a time, a wallet with a dozen names needed roughly two dozen
  // sequential round-trips: five to ten seconds before a name appeared.
  const inputs = await Promise.all(
    [...byTx.keys()].map((txHash) =>
      sources
        .txInput(txHash)
        .catch(() => null)
        .then((input) => ({ txHash, input })),
    ),
  );

  const candidates: ResolvedName[] = [];
  for (const { txHash, input } of inputs) {
    if (!input) continue;
    const labels = labelsFromStrings(decodeRegistrationStrings(input));
    if (labels.length === 0) continue;
    candidates.push(...matchNamesToTokens(labels, byTx.get(txHash) ?? [], txHash));
  }

  // The proof. Without it this would be "a name that was once minted to this
  // wallet", which is not the same claim at all.
  const owners = await Promise.all(
    candidates.map((c) => sources.ownerOf(c.tokenId).catch(() => null)),
  );
  return candidates.filter(
    (_, i) => owners[i] && owners[i]!.toLowerCase() === address.toLowerCase(),
  );
}

/** Everything DevStation can say about a wallet, from real sources only. */
export async function loadIdentity(
  address: string,
  sources: IdentitySources,
): Promise<QieIdentity> {
  const [nameCount, firstSeenAt, names] = await Promise.all([
    sources.nameCount().catch(() => 0),
    sources.firstSeenAt().catch(() => null),
    resolveNames(address, sources).catch(() => [] as ResolvedName[]),
  ]);

  return {
    address,
    names,
    nameCount,
    firstSeenAt,
    walletAgeMs: firstSeenAt === null ? null : Math.max(0, Date.now() - firstSeenAt),
    // Never populated passively: a verification request notifies the user and
    // asks for consent, so it only happens when they press the button.
    pass: null,
  };
}
