import { agentStartMessage } from "./request-auth";

// Getting, and keeping, the access grant from the browser's side.
//
// The grant is an httpOnly cookie the page cannot read, so "do I already have
// one?" is a question only the server can answer. That is the point: a value
// script can read is a value script can steal.
//
// The signer is registered once by the wallet provider rather than passed
// through every call site. Several of the callers -- appgen/build.ts is the
// clearest -- are plain modules with no access to React context, and threading
// a callback through them would put wallet plumbing in code that has no other
// reason to know a wallet exists.

type Signer = (args: { message: string }) => Promise<string>;

let signer: Signer | null = null;
let address: string | null = null;
let inFlight: Promise<boolean> | null = null;

/** Called by the wallet provider when the connection changes. */
export function setGrantSigner(next: { address: string | null; sign: Signer | null }) {
  address = next.address;
  signer = next.sign;
}

/** True when a wallet is connected, so a caller can say why something is
 *  unavailable before the user clicks it. */
export function canRequestGrant(): boolean {
  return !!address && !!signer;
}

/**
 * Make sure this browser holds a grant, asking for a signature if it does not.
 *
 * Concurrent callers share one attempt: two panels starting work at the same
 * moment would otherwise open two wallet prompts for the same signature, and
 * the second one reads as the app malfunctioning.
 */
export async function ensureGrant(): Promise<boolean> {
  if (!address || !signer) return false;
  if (inFlight) return inFlight;

  const current = { address, sign: signer };
  inFlight = (async () => {
    const issuedAt = Date.now();
    let signature: string;
    try {
      signature = await current.sign({
        message: agentStartMessage({ address: current.address, issuedAt }),
      });
    } catch {
      // Declining is a normal answer, not an error to report twice.
      return false;
    }
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: current.address, signature, issuedAt }),
    }).catch(() => null);
    return !!res?.ok;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Fetch an endpoint that needs a grant, obtaining one only if the server says
 * it is missing.
 *
 * Reactive rather than eager on purpose. Asking for a signature up front would
 * prompt people who are only reading, and the server is the only thing that
 * knows whether the cookie it issued is still valid. One retry, never a loop:
 * a second 401 means the signature was refused or is not accepted, and
 * retrying that forever is how an app ends up spamming wallet prompts.
 */
export async function fetchWithGrant(input: string, init?: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401) return first;

  const body = (await first
    .clone()
    .json()
    .catch(() => null)) as { reason?: string } | null;
  if (body?.reason !== "no_grant") return first;

  if (!(await ensureGrant())) return first;
  return fetch(input, init);
}
