// Accounts a person connects so the agent can act as them: GitHub, Vercel,
// Netlify, Railway and Supabase.
//
// Connected over OAuth (oauth.server.ts): the grant the provider returns is
// stored encrypted (AES-256-GCM, key derived from SESSION_SECRET or
// RUNNER_TOKEN) in the connectors table, which only this server can reach.
// Each message the person sends carries a fresh access token (refreshed first
// when it is about to expire) to their own sandbox for that turn, as the
// variables the providers' CLIs read (services/runner CONNECTOR_VARS); the
// browser never sees one.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbConfigured, insert, remove, select, update } from "./admin.server";
import { expiresSoon, refreshGrant, revokeGrant, type OAuthGrant } from "./oauth.server";

export type ConnectorId = "github" | "vercel" | "netlify" | "railway" | "supabase";

interface Provider {
  id: ConnectorId;
  /** Environment variables the token is given to the sandbox as. */
  env: string[];
  /** Who the token belongs to, or null when the provider refused it. */
  whoami: (token: string, team?: string) => Promise<string | null>;
}

const json = async (res: Response) =>
  res.ok ? ((await res.json()) as Record<string, unknown>) : null;
const t = (ms = 10_000) => AbortSignal.timeout(ms);

const PROVIDERS: Record<ConnectorId, Provider> = {
  github: {
    id: "github",
    env: ["GH_TOKEN", "GITHUB_TOKEN"],
    whoami: async (token) => {
      const me = await json(
        await fetch("https://api.github.com/user", {
          headers: { authorization: `Bearer ${token}`, "user-agent": "devstation" },
          signal: t(),
        }),
      );
      return me ? String(me.login ?? "GitHub account") : null;
    },
  },
  vercel: {
    id: "vercel",
    env: ["VERCEL_TOKEN"],
    whoami: async (token, team) => {
      const me = await json(
        await fetch(
          `https://api.vercel.com/v2/user${team ? `?teamId=${encodeURIComponent(team)}` : ""}`,
          {
            headers: { authorization: `Bearer ${token}` },
            signal: t(),
          },
        ),
      );
      const user = me?.user as { username?: string; email?: string } | undefined;
      return me ? String(user?.username ?? user?.email ?? "Vercel account") : null;
    },
  },
  netlify: {
    id: "netlify",
    env: ["NETLIFY_AUTH_TOKEN"],
    whoami: async (token) => {
      const me = await json(
        await fetch("https://api.netlify.com/api/v1/user", {
          headers: { authorization: `Bearer ${token}` },
          signal: t(),
        }),
      );
      return me ? String(me.full_name ?? me.email ?? "Netlify account") : null;
    },
  },
  railway: {
    id: "railway",
    env: ["RAILWAY_API_TOKEN"],
    whoami: async (token) => {
      const res = await json(
        await fetch("https://backboard.railway.com/graphql/v2", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ query: "{ me { name email } }" }),
          signal: t(),
        }),
      );
      const me = (res?.data as { me?: { name?: string; email?: string } } | undefined)?.me;
      return me ? String(me.name ?? me.email ?? "Railway account") : null;
    },
  },
  supabase: {
    id: "supabase",
    env: ["SUPABASE_ACCESS_TOKEN"],
    whoami: async (token) => {
      const me = await json(
        await fetch("https://api.supabase.com/v1/profile", {
          headers: { authorization: `Bearer ${token}` },
          signal: t(),
        }),
      );
      return me ? String(me.username || me.primary_email || "Supabase account") : null;
    },
  },
};

export const CONNECTOR_IDS = Object.keys(PROVIDERS) as ConnectorId[];

export function isConnectorId(id: unknown): id is ConnectorId {
  return typeof id === "string" && id in PROVIDERS;
}

/**
 * The keys that protect connected accounts (and OAuth state and turn passes).
 *
 * CONNECTOR_KEY is the one to set: a key of its own, so rotating the session
 * secret or the runner token never destroys stored connections. Values are
 * sealed with the newest key and marked with its version ("v2."); older
 * values (the unversioned key derived from SESSION_SECRET or RUNNER_TOKEN)
 * still open, so a rotation is a matter of setting the new variable.
 */
function keys(env: NodeJS.ProcessEnv = process.env): {
  current: Buffer | null;
  legacy: Buffer | null;
} {
  const derive = (secret: string) =>
    createHash("sha256").update(`devstation-connectors:${secret}`).digest();
  const legacySecret = env.SESSION_SECRET || env.RUNNER_TOKEN || "";
  const legacy = legacySecret ? derive(legacySecret) : null;
  const current = env.CONNECTOR_KEY ? derive(`v2:${env.CONNECTOR_KEY}`) : null;
  return { current, legacy };
}

const TAG_BYTES = 16;

function seal(token: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

function open(sealed: string, key: Buffer): string | null {
  try {
    const parts = sealed.split(".");
    if (parts.length !== 3) return null;
    const [iv, tag, body] = parts.map((p) => Buffer.from(p, "base64url"));
    // A short tag would let a forged value through with far fewer guesses.
    if (iv.length !== 12 || tag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export function sealToken(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const { current, legacy } = keys(env);
  if (current) return `v2.${seal(token, current)}`;
  if (legacy) return seal(token, legacy);
  throw new Error(
    "No key to protect connected accounts with: set CONNECTOR_KEY or SESSION_SECRET.",
  );
}

export function openToken(sealed: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const { current, legacy } = keys(env);
  if (sealed.startsWith("v2.")) return current ? open(sealed.slice(3), current) : null;
  return legacy ? open(sealed, legacy) : null;
}

export interface ConnectedAccount {
  provider: ConnectorId;
  label: string | null;
  connectedAt: string;
  /** The provider stopped accepting the grant (revoked, or it lapsed): the
   *  person needs to connect again before the agent can use it. */
  needsReconnect: boolean;
}

interface Row {
  provider: string;
  token_enc: string;
  label: string | null;
  created_at: string;
  status?: string | null;
  refresh_lease?: string | null;
  meta?: Record<string, unknown> | null;
}

const q = (owner: string, provider?: string) =>
  `owner=eq.${encodeURIComponent(owner)}${provider ? `&provider=eq.${encodeURIComponent(provider)}` : ""}`;

export async function listConnectors(owner: string): Promise<ConnectedAccount[]> {
  if (!dbConfigured()) return [];
  const rows = await select<Row>(
    "connectors",
    `${q(owner)}&select=provider,token_enc,label,created_at,status`,
  );
  return rows
    .filter((r) => isConnectorId(r.provider))
    .map((r) => ({
      provider: r.provider as ConnectorId,
      label: r.label,
      connectedAt: r.created_at,
      // A grant this server can no longer open (its key changed) needs
      // reconnecting too, rather than looking connected and doing nothing.
      needsReconnect: r.status === "needs_reconnect" || !readGrant(r.token_enc),
    }));
}

/** A stored grant. Accounts connected before OAuth hold a bare token. */
export function readGrant(sealed: string): OAuthGrant | null {
  const raw = openToken(sealed);
  if (!raw) return null;
  if (!raw.startsWith("{")) return { a: raw };
  try {
    const grant = JSON.parse(raw) as OAuthGrant;
    return typeof grant.a === "string" && grant.a ? grant : null;
  } catch {
    return null;
  }
}

/** Keep a grant the provider just issued, labelled with whose account it is.
 *  Connecting again replaces (and revokes) the previous grant. */
export async function saveGrant(
  owner: string,
  provider: ConnectorId,
  grant: OAuthGrant,
  meta: Record<string, unknown> = {},
): Promise<{ ok: true; label: string }> {
  // The name is only a label: a grant the provider just issued is kept even
  // when the app's scopes do not cover reading the profile.
  const fallback = `${provider[0].toUpperCase()}${provider.slice(1)} account`;
  const label =
    (await PROVIDERS[provider].whoami(grant.a, grant.team).catch(() => null)) ?? fallback;
  const previous = await select<Row>(
    "connectors",
    `${q(owner, provider)}&select=provider,token_enc,meta`,
  )
    .then((r) => r[0] ?? null)
    .catch(() => null);
  await insert(
    "connectors",
    {
      owner,
      provider,
      token_enc: sealToken(JSON.stringify(grant)),
      label,
      status: "ok",
      meta,
      created_at: new Date().toISOString(),
      refreshed_at: new Date().toISOString(),
      refresh_lease: null,
    },
    { upsertOn: "owner,provider" },
  );
  if (previous) {
    const old = readGrant(previous.token_enc);
    if (old && old.a !== grant.a) void revokeGrant(provider, old, previous.meta ?? {});
  }
  return { ok: true, label };
}

/** Disconnect: revoke the grant at the provider, then forget it. */
export async function deleteConnector(owner: string, provider: ConnectorId): Promise<void> {
  const row = await select<Row>(
    "connectors",
    `${q(owner, provider)}&select=provider,token_enc,meta`,
  )
    .then((r) => r[0] ?? null)
    .catch(() => null);
  await remove("connectors", q(owner, provider));
  const grant = row ? readGrant(row.token_enc) : null;
  if (grant) await revokeGrant(provider, grant, row?.meta ?? {}).catch(() => undefined);
}

/** How long a refresh may hold the lease before another may take over. */
const LEASE_MS = 30_000;

/**
 * A usable access token for one connected account, refreshed first when it
 * expires within the length of a turn.
 *
 * One refresh at a time per grant: a refresh takes a short lease on the row
 * (an update that only succeeds when no lease is held), so two turns starting
 * together never present the same refresh token twice (Railway, GitHub and
 * Supabase rotate it, and Railway revokes the whole grant on reuse). The
 * loser waits for the winner's new token. A refresh the provider refuses
 * marks the account as needing to be reconnected.
 */
async function freshGrant(owner: string, row: Row): Promise<OAuthGrant | null> {
  if (!isConnectorId(row.provider) || row.status === "needs_reconnect") return null;
  const provider = row.provider;
  let grant = readGrant(row.token_enc);
  if (!grant || !expiresSoon(grant)) return grant;

  const now = new Date();
  const leased = await update(
    "connectors",
    `${q(owner, provider)}&or=(refresh_lease.is.null,refresh_lease.lt.${new Date(now.getTime() - LEASE_MS).toISOString()})`,
    { refresh_lease: now.toISOString() },
  ).catch(() => []);
  if (leased.length === 0) {
    // Someone else is refreshing it: wait for their new token.
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const again = await select<Row>(
        "connectors",
        `${q(owner, provider)}&select=provider,token_enc,label,created_at,status,refresh_lease`,
      )
        .then((r) => r[0] ?? null)
        .catch(() => null);
      const next = again ? readGrant(again.token_enc) : null;
      if (next && !expiresSoon(next)) return next;
      if (again?.status === "needs_reconnect") return null;
    }
    return null;
  }

  const fresh = await refreshGrant(provider, grant).catch(() => null);
  if (!fresh) {
    await update("connectors", q(owner, provider), {
      status: "needs_reconnect",
      refresh_lease: null,
    }).catch(() => []);
    return null;
  }
  grant = fresh;
  await update("connectors", q(owner, provider), {
    token_enc: sealToken(JSON.stringify(grant)),
    refreshed_at: new Date().toISOString(),
    refresh_lease: null,
    status: "ok",
  }).catch(() => []);
  return grant;
}

/** One connected account's current access token, or null. */
export async function connectorToken(owner: string, provider: ConnectorId): Promise<string | null> {
  if (!dbConfigured()) return null;
  const row = await select<Row>(
    "connectors",
    `${q(owner, provider)}&select=provider,token_enc,label,created_at,status,refresh_lease`,
  )
    .then((r) => r[0] ?? null)
    .catch(() => null);
  return row ? ((await freshGrant(owner, row))?.a ?? null) : null;
}

/** The environment a turn gets from the person's connected accounts. */
export async function connectorEnvFor(owner: string): Promise<Record<string, string>> {
  if (!dbConfigured()) return {};
  const rows = await select<Row>(
    "connectors",
    `${q(owner)}&select=provider,token_enc,label,created_at,status,refresh_lease`,
  ).catch(() => [] as Row[]);
  const env: Record<string, string> = {};
  await Promise.all(
    rows.map(async (row) => {
      const grant = await freshGrant(owner, row).catch(() => null);
      if (!grant || !isConnectorId(row.provider)) return;
      for (const name of PROVIDERS[row.provider].env) env[name] = grant.a;
      if (row.provider === "vercel" && grant.team) env.VERCEL_TEAM_ID = grant.team;
    }),
  );
  return env;
}
