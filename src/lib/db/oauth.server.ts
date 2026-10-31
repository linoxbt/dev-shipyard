// "Connect your account" over OAuth for the agent's connectors: GitHub,
// Vercel, Netlify, Railway and Supabase.
//
// Each provider is an OAuth app registered by the site owner, configured by
// two variables (<PROVIDER>_OAUTH_CLIENT_ID and <PROVIDER>_OAUTH_CLIENT_SECRET;
// Vercel also needs VERCEL_INTEGRATION_SLUG), with its callback at
// /api/oauth/<provider>/callback.
//
// The flow carries its own proof: `state` is sealed (AES-256-GCM, the same key
// as stored tokens) and holds the account that started it, the PKCE verifier
// and an expiry, so the callback needs no server-side session. It is only
// accepted when the browser coming back is signed in as that same account,
// which stops someone finishing a connection of their own in your browser.

import { createHash, randomBytes } from "node:crypto";
import { openToken, sealToken, type ConnectorId } from "./connectors.server";

export interface OAuthGrant {
  /** The access token. */
  a: string;
  /** Refresh token, for providers whose access tokens expire. */
  r?: string;
  /** When the access token expires (ms since epoch). */
  e?: number;
  /** Vercel: the team the integration was installed on. */
  team?: string;
}

interface OAuthProvider {
  /** Where the person approves access. */
  authorize: (p: { clientId: string; redirect: string; state: string; challenge: string }) => URL;
  token: string;
  /** How the client authenticates at the token endpoint. */
  clientAuth: "body" | "basic";
  /** Prefix of the variables that configure it. */
  envPrefix: string;
  /** Extra variables it needs before it can start. */
  needs?: string[];
}

const PROVIDERS: Record<ConnectorId, OAuthProvider> = {
  github: {
    envPrefix: "GITHUB",
    clientAuth: "body",
    token: "https://github.com/login/oauth/access_token",
    authorize: ({ clientId, redirect, state, challenge }) =>
      withParams("https://github.com/login/oauth/authorize", {
        client_id: clientId,
        redirect_uri: redirect,
        scope: "repo workflow read:user",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
        prompt: "select_account",
      }),
  },
  vercel: {
    // An integration, not "Sign in with Vercel": its token can deploy, and it
    // does not expire. Scopes are chosen in the Integrations Console.
    envPrefix: "VERCEL",
    needs: ["VERCEL_INTEGRATION_SLUG"],
    clientAuth: "body",
    token: "https://api.vercel.com/v2/oauth/access_token",
    authorize: ({ state }) =>
      withParams(
        `https://vercel.com/integrations/${encodeURIComponent(process.env.VERCEL_INTEGRATION_SLUG ?? "")}/new`,
        { state },
      ),
  },
  netlify: {
    envPrefix: "NETLIFY",
    clientAuth: "basic",
    token: "https://api.netlify.com/oauth/token",
    authorize: ({ clientId, redirect, state }) =>
      withParams("https://app.netlify.com/authorize", {
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirect,
        state,
      }),
  },
  railway: {
    envPrefix: "RAILWAY",
    clientAuth: "basic",
    token: "https://backboard.railway.com/oauth/token",
    authorize: ({ clientId, redirect, state, challenge }) =>
      withParams("https://backboard.railway.com/oauth/auth", {
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirect,
        // offline_access with prompt=consent is what returns a refresh token.
        scope: "openid email profile offline_access workspace:member",
        prompt: "consent",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
  },
  supabase: {
    // Scopes are chosen on the OAuth app in the Supabase dashboard.
    envPrefix: "SUPABASE",
    clientAuth: "basic",
    token: "https://api.supabase.com/v1/oauth/token",
    authorize: ({ clientId, redirect, state, challenge }) =>
      withParams("https://api.supabase.com/v1/oauth/authorize", {
        client_id: clientId,
        redirect_uri: redirect,
        response_type: "code",
        state,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
  },
};

function withParams(base: string, params: Record<string, string>): URL {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

function credentials(id: ConnectorId, env: NodeJS.ProcessEnv = process.env) {
  const p = PROVIDERS[id].envPrefix;
  const clientId = env[`${p}_OAUTH_CLIENT_ID`] ?? "";
  const clientSecret = env[`${p}_OAUTH_CLIENT_SECRET`] ?? "";
  const extras = (PROVIDERS[id].needs ?? []).every((name) => !!env[name]);
  return { clientId, clientSecret, configured: !!clientId && !!clientSecret && extras };
}

/** Which providers the site owner has set up. */
export function oauthConfigured(
  env: NodeJS.ProcessEnv = process.env,
): Record<ConnectorId, boolean> {
  const out = {} as Record<ConnectorId, boolean>;
  for (const id of Object.keys(PROVIDERS) as ConnectorId[])
    out[id] = credentials(id, env).configured;
  return out;
}

export function callbackUrl(request: Request, id: ConnectorId): string {
  const url = new URL(request.url);
  // Behind Vercel the request URL is already the public one.
  return `${url.origin}/api/oauth/${id}/callback`;
}

interface StateBody {
  p: ConnectorId;
  o: string;
  v: string;
  x: number;
  back: string;
}

const STATE_TTL_MS = 15 * 60_000;

/** The URL to send the person to, or null when the provider is not set up. */
export function startUrl(
  request: Request,
  id: ConnectorId,
  owner: string,
  back: string,
  now = Date.now(),
): string | null {
  const { clientId, configured } = credentials(id);
  if (!configured) return null;
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const body: StateBody = { p: id, o: owner, v: verifier, x: now + STATE_TTL_MS, back };
  const state = sealToken(JSON.stringify(body));
  return PROVIDERS[id]
    .authorize({ clientId, redirect: callbackUrl(request, id), state, challenge })
    .toString();
}

/** The state, if it is ours, unexpired, for this provider and this account. */
export function readState(
  state: string | null,
  id: ConnectorId,
  owner: string | null,
  now = Date.now(),
): StateBody | null {
  if (!state || !owner) return null;
  const raw = openToken(state);
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as StateBody;
    if (body.p !== id || body.o !== owner || typeof body.x !== "number" || body.x < now)
      return null;
    return body;
  } catch {
    return null;
  }
}

/** Where a path to return to is safe: on this site only. */
export function safeBack(path: string | null): string {
  return path && path.startsWith("/") && !path.startsWith("//") && path.length < 300 ? path : "/";
}

async function tokenRequest(
  id: ConnectorId,
  params: Record<string, string>,
): Promise<OAuthGrant | null> {
  const provider = PROVIDERS[id];
  const { clientId, clientSecret } = credentials(id);
  const body = new URLSearchParams(params);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };
  if (provider.clientAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_id", clientId);
    body.set("client_secret", clientSecret);
  }
  const res = await fetch(provider.token, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const access = typeof data?.access_token === "string" ? data.access_token : "";
  if (!access) return null;
  const expiresIn = Number(data?.expires_in);
  return {
    a: access,
    ...(typeof data?.refresh_token === "string" ? { r: data.refresh_token } : {}),
    ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { e: Date.now() + expiresIn * 1000 } : {}),
    ...(typeof data?.team_id === "string" && data.team_id ? { team: data.team_id } : {}),
  };
}

/** Swap the code from the callback for a grant. */
export function exchangeCode(
  request: Request,
  id: ConnectorId,
  code: string,
  verifier: string,
): Promise<OAuthGrant | null> {
  return tokenRequest(id, {
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(request, id),
    // Vercel and Netlify do not use PKCE and ignore it.
    ...(id === "vercel" || id === "netlify" ? {} : { code_verifier: verifier }),
  });
}

/** A fresh grant for one whose access token is about to expire. */
export function refreshGrant(id: ConnectorId, grant: OAuthGrant): Promise<OAuthGrant | null> {
  if (!grant.r) return Promise.resolve(null);
  return tokenRequest(id, { grant_type: "refresh_token", refresh_token: grant.r }).then(
    (fresh) => fresh && { ...fresh, r: fresh.r ?? grant.r, team: fresh.team ?? grant.team },
  );
}

/** Whether a grant needs refreshing before it is handed to a turn. */
export function expiresSoon(grant: OAuthGrant, now = Date.now()): boolean {
  return !!grant.e && grant.e - now < 5 * 60_000;
}
