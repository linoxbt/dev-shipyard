// QIE ID: `.qie` names, as they actually exist on chain.
//
// What follows was established by probing the deployed contracts directly, not
// from assumption. It is written down because the gap between the branding and
// the deployment is wide enough to mislead:
//
//   QIE ID (0x9aab…7bdc on QIE Mainnet) is a plain ERC-721Enumerable of `.qie`
//   names, registered through a proxy registrar (0x1d69…f62e, selector
//   0xbc96db3f) at domains.qie.digital.
//   Present:  name, symbol, totalSupply, balanceOf, ownerOf, tokenURI,
//             tokenOfOwnerByIndex, tokenByIndex, supportsInterface, mint.
//   Absent:   every resolver shape (addr, nameOf, primaryName, reverse…) and
//             any profile or verification function. tokenURI returns an empty
//             string, so there is no metadata to read either.
//
//   The name is therefore NOT readable from a contract. It is carried in the
//   calldata of the registration that minted the token, and is recovered from
//   there. Which tokens a wallet holds IS readable from the contract
//   (balanceOf + tokenOfOwnerByIndex), and that is the proof: a name is shown
//   for a wallet only if the contract says the wallet owns its token right
//   now. A name that was sold disappears; a name received as a transfer shows.
//
//   Token ids are not derived from the name by any obvious scheme (keccak,
//   namehash, sha256 and abi-encoded variants were all tested and none match),
//   so a name is tied to its token by the transaction that minted both.
//
// Not every name is one somebody registered. The registrar's call is
// `register(Order order, bool isFree)`, and QIE's own backend hands new wallets a
// free, randomly generated name (`ykhli97464.qie`) with isFree set: in a sample of
// 120 recent registrations, 108 were those. A free name is a placeholder, not an
// identity, so only names registered with isFree false are shown.
//
// Reputation shown in DevStation is DevStation's own, derived from what builders
// did on chain (see lib/reputation.ts). QIE ID carries no score.

/** Where people register a `.qie` name. */
export const QIE_ID_REGISTER_URL = "https://domains.qie.digital/";

/** QIE ID lives on QIE Mainnet only. Identity is the same whichever network
 *  the app is pointed at, so names are always resolved there. */
export const QIE_ID_CHAIN_ID = 1990;

/** The calls that are sound on the QIE ID registry.
 *
 *  Deliberately minimal: a mismatched deployment then fails on the call rather
 *  than silently decoding the wrong storage slot. */
export const qieIdAbi = [
  {
    inputs: [{ name: "owner", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    name: "tokenOfOwnerByIndex",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** A `.qie` name a wallet provably holds. */
export interface QieName {
  /** The registered label, exactly as it appears in the registration. */
  label: string;
  /** Top-level domain, effectively always "qie". */
  tld: string;
  /** Rendered form: `label.tld`. */
  full: string;
  /** The ERC-721 token id whose ownership proves the claim. */
  tokenId: string;
  /** Transaction that registered it. */
  txHash: string;
}

/** Where a name came from, so the UI can be honest about confidence. */
export type NameConfidence =
  /** One name and one token in the registration: unambiguous. */
  | "exact"
  /** Several names registered together, matched by position. */
  | "positional";

export interface ResolvedName extends QieName {
  confidence: NameConfidence;
}

/** Everything DevStation can say about a wallet's QIE identity. */
export interface QieIdentity {
  address: string;
  /** Names the wallet provably holds, in the contract's enumeration order;
   *  empty is a real answer, not a failure. */
  names: ResolvedName[];
  /** Names the wallet holds that somebody registered: balanceOf, less the free
   *  names QIE hands out. May exceed names.length when a registration could
   *  not be indexed: the count is authoritative, the labels are best effort. */
  nameCount: number;
  /** Milliseconds since the wallet's first activity, null when unknown. */
  walletAgeMs: number | null;
  firstSeenAt: number | null;
}

/** ASCII strings in a registration's calldata, in the order they appear.
 *
 *  Registration calldata is a struct array whose string members sit in the
 *  tail; every 32-byte word that decodes to printable ASCII is one of them.
 *  Crude, and correct for this shape: the alternative is an ABI the registrar
 *  does not publish. */
export function decodeRegistrationStrings(rawInput: string): string[] {
  const body = rawInput.startsWith("0x") ? rawInput.slice(10) : rawInput;
  const out: string[] = [];
  for (let i = 0; i + 64 <= body.length; i += 64) {
    const word = body.slice(i, i + 64);
    // ABI strings are LEFT-aligned and zero-padded on the right. A number is
    // right-aligned, so its significant bytes sit at the end. Requiring the
    // first byte to be printable rejects numbers outright, without it, a
    // small integer like 0x616263 decodes to "abc" and is treated as a
    // registered name.
    const firstByte = parseInt(word.slice(0, 2), 16);
    if (firstByte < 32 || firstByte > 126) continue;

    let text = "";
    let padding = false;
    let ok = true;
    for (let j = 0; j < 64; j += 2) {
      const code = parseInt(word.slice(j, j + 2), 16);
      if (code === 0) {
        // Everything after the first pad byte must also be padding; a zero in
        // the middle means this was never a string.
        padding = true;
        continue;
      }
      if (padding || code < 32 || code > 126) {
        ok = false;
        break;
      }
      text += String.fromCharCode(code);
    }
    if (ok && isPlausibleLabel(text)) out.push(text);
  }
  return out;
}

/** The registrar's `register(Order order, bool isFree)`. */
export const REGISTER_SELECTOR = "bc96db3f";

/**
 * Whether a registration was one of the free names QIE hands out.
 *
 * `isFree` is the call's second argument, the word right after the offset to
 * the order. True or false when the calldata is that call; null when it is not,
 * or the word is not a bool, so nothing unrecognised is hidden on a guess.
 */
export function registrationIsFree(rawInput: string): boolean | null {
  const body = rawInput.startsWith("0x") ? rawInput.slice(2) : rawInput;
  if (body.slice(0, 8).toLowerCase() !== REGISTER_SELECTOR) return null;
  const flag = body.slice(8 + 64, 8 + 128);
  if (!/^[0-9a-fA-F]{64}$/.test(flag)) return null;
  if (/^0{64}$/.test(flag)) return false;
  if (/^0{63}1$/.test(flag)) return true;
  return null;
}

/** Does this look like a registerable label rather than incidental bytes?
 *
 *  Domain labels are lowercase alphanumerics and hyphens. Checking the charset
 *  is what stops a stray word being shown to someone as their registered
 *  identity. */
export function isPlausibleLabel(text: string): boolean {
  if (text.length < 2 || text.length > 63) return false;
  if (!/^[a-z0-9-]+$/.test(text)) return false;
  // A label cannot start or end with a hyphen, by the same convention every
  // DNS-shaped registry follows.
  return !text.startsWith("-") && !text.endsWith("-");
}

/** Pull the registered labels out of one registration's strings.
 *
 *  The TLD is repeated around each label, so it is filtered out rather than
 *  mistaken for a name. */
export function labelsFromStrings(strings: string[], tld = "qie"): string[] {
  return strings.filter((s) => s.toLowerCase() !== tld.toLowerCase());
}

/**
 * Tie labels to the tokens minted in the same transaction.
 *
 * `tokenIds` is every token the registration minted, in mint order. One label
 * and one token is unambiguous and marked "exact". Several are matched by
 * position and marked "positional", so the UI can present the difference
 * rather than implying certainty it does not have.
 */
export function matchNamesToTokens(
  labels: string[],
  tokenIds: string[],
  txHash: string,
  tld = "qie",
): ResolvedName[] {
  const confidence: NameConfidence =
    labels.length === 1 && tokenIds.length === 1 ? "exact" : "positional";
  const pairs = Math.min(labels.length, tokenIds.length);
  const out: ResolvedName[] = [];
  for (let i = 0; i < pairs; i++) {
    out.push({
      label: labels[i],
      tld,
      full: `${labels[i]}.${tld}`,
      tokenId: tokenIds[i],
      txHash,
      confidence,
    });
  }
  return out;
}

/** Human wallet age. Deliberately coarse: "3 years" is the useful signal, and
 *  a day count implies a precision that a first-transaction timestamp does not
 *  really carry. */
export function formatWalletAge(ms: number | null): string {
  if (ms === null || ms < 0) return "unknown";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(days / 365);
  const rem = Math.floor((days % 365) / 30);
  return rem > 0 ? `${years}y ${rem}m` : `${years} year${years === 1 ? "" : "s"}`;
}
