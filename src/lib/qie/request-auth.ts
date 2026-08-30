// Proving a verification request is for the wallet that asked for it.
//
// Creating a QIE Pass request makes QIE notify a real person and ask them to
// approve sharing their identity. Without this, an anonymous caller could aim
// that at any wallet, username or .qie name they liked, using DevStation's
// partner credentials — the prompts would carry DevStation's name and the
// damage would land on DevStation's standing with QIE, not on the sender.
//
// So the rule is simple: you may only request verification for a wallet you
// can prove you control. Same shape as the sponsor top-up signature, because
// the problem is the same one.

/** How long a signature stays usable. Long enough to sign and send, short
 *  enough that a leaked one is worthless. */
export const QIE_SIG_TTL_MS = 5 * 60 * 1000;
/** Wall clocks disagree; a little tolerance avoids rejecting honest requests. */
const CLOCK_SKEW_MS = 60 * 1000;

/** The exact text the wallet signs. Must match byte for byte on both sides,
 *  so it lives here rather than being rebuilt in two places. */
export function verifyRequestMessage(params: {
  address: string;
  identifier: string;
  issuedAt: number;
}): string {
  return [
    "DevStation identity verification request",
    "",
    `address: ${params.address.toLowerCase()}`,
    `identifier: ${params.identifier.toLowerCase()}`,
    `issuedAt: ${new Date(params.issuedAt).toISOString()}`,
    "",
    "Signing this proves you control this wallet and asks QIE to verify your",
    "identity. It costs no gas and authorises no transfer from your wallet.",
  ].join("\n");
}

export type QieAuthProblem = "expired" | "future" | "bad_signature" | "identifier_mismatch";

/** Is this timestamp usable right now? */
export function issuedAtProblem(issuedAt: number, now = Date.now()): QieAuthProblem | null {
  if (!Number.isFinite(issuedAt)) return "expired";
  if (issuedAt > now + CLOCK_SKEW_MS) return "future";
  if (now - issuedAt > QIE_SIG_TTL_MS) return "expired";
  return null;
}

/**
 * May this wallet request verification for this identifier?
 *
 * Only for itself. A `.qie` name or @username belongs to whoever controls it,
 * and DevStation cannot check that from here — so the identifier must be the
 * signing wallet's own address, and QIE resolves the rest.
 */
export function identifierAllowed(address: string, identifier: string): boolean {
  return address.toLowerCase() === identifier.toLowerCase();
}

/** Human wording for each refusal. Vague on purpose about which part failed —
 *  it says what to do, not what an attacker got closest to. */
export const AUTH_PROBLEM_MESSAGE: Record<QieAuthProblem, string> = {
  expired: "That request expired. Try again.",
  future: "Your device clock looks wrong. Check it and try again.",
  bad_signature: "Could not verify that signature came from your wallet.",
  identifier_mismatch: "You can only request verification for your own wallet.",
};
