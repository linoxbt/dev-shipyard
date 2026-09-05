// QIE-native identity, as it actually exists on chain and in QIE's own API.
//
// What follows was established by probing the deployed contracts and QIE's
// partner API directly, not from assumption. It is written down because the
// gap between the branding and the deployment is wide enough to mislead:
//
//   QIE ID (0x9aab…7bdc) is a plain ERC-721Enumerable of `.qie` names.
//   Present:  name, symbol, totalSupply, balanceOf, ownerOf, tokenURI,
//             tokenOfOwnerByIndex, tokenByIndex, supportsInterface, mint.
//   Absent:   every resolver shape (addr, nameOf, primaryName, reverse…),
//             every reputation/verification/profile/pass function. 43 standard
//             signatures were tested across the NFT and its registrar; none
//             exist. tokenURI on a REAL token id returns an empty string, so
//             there is no metadata to read either.
//
//   The name is therefore NOT readable from a contract. It is recoverable
//   from the registration transaction, whose calldata carries it, and is then
//   verified by confirming the wallet still owns the token that transaction
//   minted. That is authoritative: it comes from the registration itself -
//   and it cannot be spoofed, because ownership is checked on chain.
//
//   Token ids are not derived from the name by any obvious scheme (keccak,
//   namehash, sha256 and abi-encoded variants were all tested and none match),
//   so a name is tied to a token by the transaction that created both.
//
//   QIE Identity / QIE Pass (did-stapi.qie.digital) is a consent-based
//   verifiable-credential API, not a lookup. It answers "is this identity
//   verified" only after the user approves a request, and it offers KYC
//   claims: firstName, dateOfBirth, citizenship, age_over_18 and similar.
//   It offers NO reputation score and NO wallet age.
//
// Consequently: reputation shown in DevStation is DevStation's own, derived
// from the onchain ProjectRegistry (see lib/reputation.ts). There is no QIE
// reputation score to display, and inventing one would be a lie about a
// number users are asked to trust.

/** The only calls that are sound on the QIE ID registry.
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

/** The consent states QIE's partner API reports. */
export type PassStatus =
  | "pending_kyc"
  | "pending_consent"
  | "consent_given"
  | "consent_rejected"
  | "expired"
  | "failed";

/** Whether the identity behind an identifier has completed KYC with QIE. */
export type UserStatus = "verified" | "not_verified";

/** Claims QIE offers. Enumerated from their own documentation rather than
 *  guessed: note there is no reputation or wallet-age claim among them. */
export const QIE_CLAIMS = [
  "firstName",
  "lastName",
  "dateOfBirth",
  "citizenship",
  "nationality",
  "gender",
  "age_over_18",
  "age_over_21",
  "age_over_25",
  "age_over_65",
  "age_18_to_25",
  "age_26_to_65",
  "is_us_citizen",
  "is_eu_citizen",
  "is_us_national",
  "is_eu_national",
] as const;
/** One claim identifier. Exported for callers building their own request
 *  bodies; the route validates against QIE_CLAIMS itself. */
export type QieClaim = (typeof QIE_CLAIMS)[number];

export interface PassState {
  status: PassStatus;
  userStatus: UserStatus;
  requestId: string;
  walletAddress?: string;
  expiresAt?: string;
  redirectUrl?: string;
}

/** Everything DevStation can say about a wallet's QIE identity. */
export interface QieIdentity {
  address: string;
  /** Names the wallet provably holds; empty is a real answer, not a failure. */
  names: ResolvedName[];
  /** Count from balanceOf. May exceed names.length when a registration could
   *  not be indexed: the count is authoritative, the labels are best effort. */
  nameCount: number;
  /** Milliseconds since the wallet's first transaction, null when unknown. */
  walletAgeMs: number | null;
  firstSeenAt: number | null;
  /** Present only after the user has consented through QIE Pass. */
  pass: PassState | null;
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
 * One label and one token is unambiguous and marked "exact". Several are
 * matched by position and marked "positional", so the UI can present the
 * difference rather than implying certainty it does not have.
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

/** How a pass state reads to a person. */
export function describePass(pass: PassState | null): {
  tone: "verified" | "pending" | "rejected" | "none";
  label: string;
} {
  if (!pass) return { tone: "none", label: "Not verified with QIE Pass" };
  if (pass.status === "consent_given" && pass.userStatus === "verified") {
    return { tone: "verified", label: "Verified with QIE Pass" };
  }
  switch (pass.status) {
    case "pending_kyc":
      return { tone: "pending", label: "Awaiting KYC with QIE" };
    case "pending_consent":
      return { tone: "pending", label: "Awaiting your consent" };
    case "consent_rejected":
      return { tone: "rejected", label: "Consent declined" };
    case "expired":
      return { tone: "rejected", label: "Request expired" };
    case "failed":
      return { tone: "rejected", label: "Verification failed" };
    default:
      return { tone: "none", label: "Not verified with QIE Pass" };
  }
}
