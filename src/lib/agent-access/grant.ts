// Getting, and keeping, DevStation's session from the browser's side.
//
// The session is an httpOnly cookie the page cannot read, so "do I already
// have one?" is a question only the server can answer. That is the point: a
// value script can read is a value script can steal.
//
// It comes from the email sign-in alone: the current Supabase access token is
// traded for it (POST /api/access/session), and the server asks Supabase who
// the token belongs to. The sign-in store registers how to read that token
// (hooks/useAuth.ts) and asks for a fresh session whenever Supabase signs in
// or refreshes its token, so the cookie never outlives the sign-in or lags
// behind a switch of account.

let inFlight: Promise<boolean> | null = null;
/** The current Supabase access token, read fresh each time. */
let sessionToken: (() => Promise<string | null>) | null = null;

/** Called by the sign-in store when a session starts or ends. */
export function setGrantSession(next: (() => Promise<string | null>) | null) {
  sessionToken = next;
}

/** True when someone is signed in, so a caller can say why something is
 *  unavailable before the user clicks it. */
export function canRequestGrant(): boolean {
  return !!sessionToken;
}

/**
 * Trade the signed-in session for DevStation's cookie. Concurrent callers
 * share one attempt.
 */
export async function ensureGrant(): Promise<boolean> {
  if (inFlight) return inFlight;
  const token = sessionToken;
  if (!token) return false;
  inFlight = (async () => {
    const accessToken = await token().catch(() => null);
    if (!accessToken) return false;
    const res = await fetch("/api/access/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken }),
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
 * Fetch an endpoint that needs the session, renewing it once if the server
 * says it is missing or belongs to another account. One retry, never a loop.
 */
export async function fetchWithGrant(input: string, init?: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 401 && first.status !== 403) return first;

  const body = (await first
    .clone()
    .json()
    .catch(() => null)) as { reason?: string } | null;
  const missing = first.status === 401 && body?.reason === "no_grant";
  const stale = first.status === 403 && body?.reason === "owner_mismatch";
  if (!missing && !stale) return first;

  if (!(await ensureGrant())) return first;
  return fetch(input, init);
}
