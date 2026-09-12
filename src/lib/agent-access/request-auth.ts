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
 * The exact message a wallet signs to start a run.
 *
 * The project is in it so a signature for one project cannot be replayed to
 * start work on another, and the timestamp so it expires. It says plainly that
 * it authorises no transfer, because a wallet prompt with no explanation is
 * how people learn to sign things without reading them.
 */
export function agentStartMessage(params: { address: string; issuedAt: number }): string {
  return [
    "DevStation agent run",
    "",
    `address: ${params.address.toLowerCase()}`,
    `issuedAt: ${new Date(params.issuedAt).toISOString()}`,
    "",
    "Signing this proves you control this wallet, so the run can be billed and",
    "attributed to you. It costs no gas and authorises no transfer.",
  ].join("\n");
}

export type AgentAuthProblem = "expired" | "future" | "bad_signature";

export const AGENT_AUTH_MESSAGE: Record<AgentAuthProblem, string> = {
  expired: "That request expired. Try again.",
  future: "Your device clock looks wrong. Check it and try again.",
  bad_signature: "Could not verify that signature came from your wallet.",
};

/** Timestamp window check, split out so it is unit-testable without crypto. */
export function issuedAtProblem(issuedAt: number, now = Date.now()): AgentAuthProblem | null {
  if (!Number.isFinite(issuedAt)) return "expired";
  if (issuedAt > now + CLOCK_SKEW_MS) return "future";
  if (now - issuedAt > AGENT_SIG_TTL_MS) return "expired";
  return null;
}
