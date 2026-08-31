import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// GitHub sign-in, server side.
//
// OAuth rather than a pasted token because an OAuth token can do the two things
// a fine-grained PAT cannot — create a repository (POST /user/repos) and read
// the signed-in account (GET /user) — which is what collapses the flow to
// "connect once, then push".
//
// The access token is held in an httpOnly cookie and never reaches JavaScript,
// so the push has to run on the server. That is a deliberate reversal of the
// PAT design: a pasted PAT was the user's own secret and was best kept out of
// our infrastructure, whereas an OAuth token is issued TO this app and the
// server is where it belongs.

const COOKIE = "devstation_gh";
const STATE_COOKIE = "devstation_gh_state";
/** GitHub tokens do not expire on their own; this caps how long one session
 *  stays usable so an abandoned browser is not indefinitely authorised. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  configured: boolean;
}

export function githubConfig(): GithubConfig {
  const e = process.env;
  const clientId = e.GITHUB_CLIENT_ID ?? "";
  const clientSecret = e.GITHUB_CLIENT_SECRET ?? "";
  return { clientId, clientSecret, configured: !!clientId && !!clientSecret };
}

/** Signing key for the session cookie and the CSRF state. Falls back to the
 *  client secret so there is one less thing to configure — it is already a
 *  server-only secret of exactly the right shape. */
function signingKey(): string {
  return process.env.GITHUB_SESSION_SECRET || githubConfig().clientSecret;
}

function sign(value: string): string {
  return createHmac("sha256", signingKey()).update(value).digest("base64url");
}

/** Signed so a forged cookie cannot hand the server an attacker's token —
 *  every request that pushes code is authorised by this value. */
export function sealSession(token: string): string {
  const payload = Buffer.from(JSON.stringify({ token, exp: Date.now() + SESSION_TTL_MS })).toString(
    "base64url",
  );
  return `${payload}.${sign(payload)}`;
}

export function openSession(raw: string | undefined): string | null {
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const expected = sign(payload);
  // Constant time: a leaky comparison here is a forgeable session.
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { token, exp } = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      token?: string;
      exp?: number;
    };
    if (!token || !exp || exp < Date.now()) return null;
    return token;
  } catch {
    return null;
  }
}

export function newState(): string {
  const nonce = randomBytes(16).toString("base64url");
  return `${nonce}.${sign(nonce)}`;
}

export function stateValid(raw: string | undefined): boolean {
  if (!raw) return false;
  const [nonce, mac] = raw.split(".");
  if (!nonce || !mac) return false;
  const a = Buffer.from(mac);
  const b = Buffer.from(sign(nonce));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export const COOKIE_NAME = COOKIE;
export const STATE_COOKIE_NAME = STATE_COOKIE;

export function sessionCookie(value: string, secure: boolean): string {
  // httpOnly: the token must never be readable from the page. SameSite=Lax so
  // it survives the redirect back from GitHub but is not sent cross-site.
  return `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    SESSION_TTL_MS / 1000,
  )}${secure ? "; Secure" : ""}`;
}

export function clearedCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

export function stateCookie(value: string, secure: boolean): string {
  return `${STATE_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${
    secure ? "; Secure" : ""
  }`;
}

/** The callback URL for whichever origin the request arrived on, so the same
 *  build works on localhost, the branch deploy and production — each with its
 *  own registered OAuth app. */
export function callbackUrl(request: Request): string {
  return `${new URL(request.url).origin}/api/github/callback`;
}
