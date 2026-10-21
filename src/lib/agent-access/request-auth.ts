// Proof that whoever started an agent run controls the wallet they claim.
//
// /api/agent had no authentication at all. Anyone who could reach the site
// could start turns that spend the operator's model credits and execute
// model-chosen commands on the runner host. The only control was an in-memory
// IP rate limit, and rateLimit.server.ts says in its own header that it is
// friction rather than a boundary: it is per-instance and resets on a cold
// start.
//
// A signature is the control this codebase already uses for the other endpoint
// that spends real resources (lib/sponsor/request-auth.ts). It costs no gas,
// it cannot be replayed onto another project or after five minutes, and it
// gives every job an owner, which is what the job-claim cookie then binds to.
//
// Shared by the client that signs and the server that verifies, so the exact
// bytes can never drift apart.

/** Long enough for a slow hardware wallet, short enough that a signature
 *  captured from a log is not useful later. */
export const AGENT_SIG_TTL_MS = 5 * 60 * 1000;

/** Allowance for the user's clock running ahead of the server's. */
const CLOCK_SKEW_MS = 60 * 1000;

/**
 * The exact message a wallet signs for the access grant, in EIP-4361
 * (Sign-In with Ethereum) form.
 *
 * It used to be a bare "address + timestamp" text. Any site could ask for
 * those exact bytes, and one signature minted a fresh grant as often as it was
 * replayed within five minutes. Now it names the domain and URI it is for, so
 * a wallet that understands EIP-4361 warns when another site asks for it, and
 * carries a nonce the server issued to THIS browser in an httpOnly cookie and
 * accepts once.
 */
export function accessMessage(params: {
  domain: string;
  uri: string;
  address: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
}): string {
  return [
    `${params.domain} wants you to sign in with your Ethereum account:`,
    params.address.toLowerCase(),
    "",
    "Sign in to DevStation so runs, builds and publishes can be billed and attributed to " +
      "you. It costs no gas and authorises no transfer.",
    "",
    `URI: ${params.uri}`,
    "Version: 1",
    `Chain ID: ${params.chainId}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${new Date(params.issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(params.issuedAt + AGENT_SIG_TTL_MS).toISOString()}`,
  ].join("\n");
}

export type AgentAuthProblem = "expired" | "future" | "bad_signature" | "bad_nonce";

export const AGENT_AUTH_MESSAGE: Record<AgentAuthProblem, string> = {
  expired: "That request expired. Try again.",
  future: "Your device clock looks wrong. Check it and try again.",
  bad_signature: "Could not verify that signature came from your wallet.",
  bad_nonce: "That sign-in request expired or was already used. Try again.",
};

/** Timestamp window check, split out so it is unit-testable without crypto. */
export function issuedAtProblem(
  issuedAt: number,
  now = Date.now(),
): Exclude<AgentAuthProblem, "bad_signature" | "bad_nonce"> | null {
  if (!Number.isFinite(issuedAt)) return "expired";
  if (issuedAt > now + CLOCK_SKEW_MS) return "future";
  if (now - issuedAt > AGENT_SIG_TTL_MS) return "expired";
  return null;
}
