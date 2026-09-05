// Proof that whoever asked for a gas top-up actually controls the wallet the
// funds will land in.
//
// The sponsor endpoint sends real mainnet token to `requesterAddress`. Without
// this, the endpoint is an open faucet: anyone could POST any address in a
// loop and drain the daily budget into wallets they own. A signature costs no
// gas, so this does not break the whole point of sponsorship: a user with a
// zero balance can still sign.
//
// Shared by the client (which signs) and the server (which verifies) so the
// two can never drift out of sync on the exact bytes being signed.

/** How long a signed request stays valid. Long enough for a slow wallet
 *  confirmation, short enough that a leaked signature is not reusable. */
export const TOPUP_SIG_TTL_MS = 5 * 60 * 1000;

/** Allowance for the user's clock running ahead of the server's. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * The exact message the wallet signs. Includes the chain and the recipient so
 * a signature captured for one chain or address cannot be replayed against
 * another, and a timestamp so it expires.
 */
export function topupMessage(params: {
  address: string;
  chainId: number;
  issuedAt: number;
}): string {
  return [
    "DevStation gas top-up request",
    "",
    `address: ${params.address.toLowerCase()}`,
    `chainId: ${params.chainId}`,
    `issuedAt: ${new Date(params.issuedAt).toISOString()}`,
    "",
    "Signing this proves you control this wallet. It costs no gas and",
    "authorises no transfer from your wallet.",
  ].join("\n");
}

export type TopupAuthProblem = "expired" | "future" | "bad_signature";

/** Timestamp window check, split out so it can be unit-tested without crypto. */
export function issuedAtProblem(issuedAt: number, now = Date.now()): TopupAuthProblem | null {
  if (!Number.isFinite(issuedAt)) return "expired";
  if (issuedAt > now + CLOCK_SKEW_MS) return "future";
  if (now - issuedAt > TOPUP_SIG_TTL_MS) return "expired";
  return null;
}
