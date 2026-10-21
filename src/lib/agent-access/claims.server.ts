import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Which jobs this browser is allowed to touch.
//
// Every job endpoint used to be authorised by knowing an id and nothing else.
// That made three things possible for anyone holding or guessing one: reading
// a stranger's run (its goal, its diff, its output), cancelling it, and -- on
// the repo route -- answering an approval prompt or pulling the resulting
// change into a repository of their own choosing. An id is a capability, and a
// capability with no second factor is the whole of the security model.
//
// So the server seals the ids it issued into an httpOnly cookie and checks
// membership on every read and every mutation. The cookie is signed, never
// read by JavaScript, and holds no secret of its own: forging one requires the
// signing key, and losing it costs the user nothing but a restarted run.
//
// Deliberately not a database. This app has no shared store, which is exactly
// why job ownership could not simply be looked up, and a sealed cookie is the
// one mechanism that survives a serverless host with no state.

const MAX_CLAIMS = 30;
/** A run is minutes of work. A day is generous and bounds how long a stolen
 *  cookie is worth anything. */
const TTL_MS = 24 * 60 * 60 * 1000;

export const CLAIM_COOKIE = "devstation_jobs";

/**
 * The signing key.
 *
 * SESSION_SECRET is the one to set. The fallback to RUNNER_TOKEN is not
 * laziness: the agent endpoints cannot function without RUNNER_TOKEN anyway,
 * so anywhere these claims matter, that value exists and is already a
 * server-only secret of the right shape. The last resort is a per-process
 * random key, which fails closed rather than open: claims stop verifying
 * across instances, so a user is asked to start again instead of a forged
 * cookie being accepted.
 */
let ephemeralKey: string | null = null;
function signingKey(): string {
  const configured = process.env.SESSION_SECRET || process.env.RUNNER_TOKEN;
  if (configured) return configured;
  if (!ephemeralKey) {
    ephemeralKey = randomBytes(32).toString("hex");
    // Said once, at the point it matters, rather than silently.
    console.warn(
      "[devstation] No SESSION_SECRET or RUNNER_TOKEN is set, so job claims are signed with a " +
        "per-process key. Runs will not survive a restart. Set SESSION_SECRET.",
    );
  }
  return ephemeralKey;
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("base64url");
}

interface ClaimPayload {
  /** Job ids this browser started. */
  ids: string[];
  /** The wallet that signed for them, for attribution and for the runner. */
  owner: string;
  exp: number;
}

export function sealClaims(claim: ClaimPayload): string {
  const payload = Buffer.from(JSON.stringify(claim)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function openClaims(raw: string | undefined): ClaimPayload | null {
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  // Constant time: a leaky comparison here is a forgeable claim.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(payload, "base64url").toString(),
    ) as Partial<ClaimPayload>;
    if (!Array.isArray(parsed.ids) || typeof parsed.exp !== "number") return null;
    if (parsed.exp < Date.now()) return null;
    return {
      ids: parsed.ids.filter((i) => typeof i === "string"),
      owner: parsed.owner ?? "",
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/** Add one id, keeping the newest MAX_CLAIMS. Bounded because a cookie has a
 *  4KB limit and an unbounded list would eventually stop being sent at all,
 *  locking a user out of their own runs. */
export function withClaim(existing: ClaimPayload | null, id: string, owner: string): ClaimPayload {
  const ids = [...(existing?.ids ?? []).filter((i) => i !== id), id].slice(-MAX_CLAIMS);
  return { ids, owner, exp: Date.now() + TTL_MS };
}

/** Start or renew a grant, keeping any job ids already held. */
export function withOwner(existing: ClaimPayload | null, owner: string): ClaimPayload {
  return { ids: existing?.ids ?? [], owner, exp: Date.now() + TTL_MS };
}

/** The verified wallet behind this request, or null when there is no grant. */
export function ownerOf(claims: ClaimPayload | null): string | null {
  return claims?.owner ? claims.owner : null;
}

export function holdsClaim(claims: ClaimPayload | null, id: string): boolean {
  return !!claims?.ids.includes(id);
}

/** The Set-Cookie value. httpOnly so script cannot read it, SameSite=Lax so it
 *  is not sent from a third-party page, Secure outside development. */
export function claimCookieHeader(claim: ClaimPayload): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${CLAIM_COOKIE}=${sealClaims(claim)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(TTL_MS / 1000)}${secure}`;
}

/** One cookie out of a Cookie header. */
export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

// The sign-in nonce.
//
// Issued by GET /api/access?nonce into a short-lived httpOnly cookie, so only
// this browser holds it; POST /api/access requires the signed message to carry
// the same value and clears the cookie. The usedNonce check in api.access.ts
// refuses a second use while the nonce is still live.

export const NONCE_COOKIE = "devstation_access_nonce";
/** As long as the signature itself is valid for, plus a slow wallet. */
const NONCE_TTL_MS = 10 * 60 * 1000;

export function issueNonce(now = Date.now()): { nonce: string; sealed: string } {
  // EIP-4361 nonces are alphanumeric, at least 8 characters.
  const nonce = randomBytes(16).toString("hex");
  const payload = `${nonce}.${now + NONCE_TTL_MS}`;
  return { nonce, sealed: `${payload}.${sign(`nonce:${payload}`)}` };
}

/** The nonce in a sealed cookie value, or null if forged or expired. */
export function openNonce(raw: string | undefined, now = Date.now()): string | null {
  if (!raw) return null;
  const [nonce, exp, mac] = raw.split(".");
  if (!nonce || !exp || !mac) return null;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(`nonce:${nonce}.${exp}`));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (!/^[0-9a-f]{32}$/.test(nonce) || Number(exp) < now) return null;
  return nonce;
}

export function nonceCookieHeader(sealed: string | null): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = sealed ? Math.floor(NONCE_TTL_MS / 1000) : 0;
  return `${NONCE_COOKIE}=${sealed ?? ""}; Path=/api/access; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

/** An HMAC over `value` with the claims key, for small server-issued
 *  capabilities (see api.apps-deploy.ts's site token). */
export function signValue(value: string): string {
  return sign(`value:${value}`);
}

/** Constant-time check of a signValue result. */
export function verifyValue(value: string, mac: string | undefined): boolean {
  if (!mac) return false;
  const a = Buffer.from(mac);
  const b = Buffer.from(signValue(value));
  return a.length === b.length && timingSafeEqual(a, b);
}
