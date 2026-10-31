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
import { dbConfigured, insert, remove, select } from "./admin.server";
import { expiresSoon, refreshGrant, type OAuthGrant } from "./oauth.server";

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

function cipherKey(): Buffer | null {
  const secret = process.env.SESSION_SECRET || process.env.RUNNER_TOKEN || "";
  return secret ? createHash("sha256").update(`devstation-connectors:${secret}`).digest() : null;
}

export function sealToken(token: string, key = cipherKey()): string {
  if (!key) throw new Error("No key to protect connected accounts with: set SESSION_SECRET.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64url")).join(".");
}

export function openToken(sealed: string, key = cipherKey()): string | null {
  if (!key) return null;
  try {
    const [iv, tag, body] = sealed.split(".").map((p) => Buffer.from(p, "base64url"));
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export interface ConnectedAccount {
  provider: ConnectorId;
  label: string | null;
  connectedAt: string;
}

export async function listConnectors(owner: string): Promise<ConnectedAccount[]> {
  if (!dbConfigured()) return [];
  const rows = await select<{ provider: string; label: string | null; created_at: string }>(
    "connectors",
    `owner=eq.${encodeURIComponent(owner)}&select=provider,label,created_at`,
  );
  return rows
    .filter((r) => isConnectorId(r.provider))
    .map((r) => ({
      provider: r.provider as ConnectorId,
      label: r.label,
      connectedAt: r.created_at,
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

async function keep(owner: string, provider: ConnectorId, grant: OAuthGrant, label: string) {
  await insert(
    "connectors",
    {
      owner,
      provider,
      token_enc: sealToken(JSON.stringify(grant)),
      label,
      created_at: new Date().toISOString(),
    },
    { upsertOn: "owner,provider" },
  );
}

/** Keep a grant the provider just issued, labelled with whose account it is. */
export async function saveGrant(
  owner: string,
  provider: ConnectorId,
  grant: OAuthGrant,
): Promise<{ ok: true; label: string }> {
  // The name is only a label: a grant the provider just issued is kept even
  // when the app's scopes do not cover reading the profile.
  const fallback = `${provider[0].toUpperCase()}${provider.slice(1)} account`;
  const label =
    (await PROVIDERS[provider].whoami(grant.a, grant.team).catch(() => null)) ?? fallback;
  await keep(owner, provider, grant, label);
  return { ok: true, label };
}

export async function deleteConnector(owner: string, provider: ConnectorId): Promise<void> {
  await remove(
    "connectors",
    `owner=eq.${encodeURIComponent(owner)}&provider=eq.${encodeURIComponent(provider)}`,
  );
}

/** The environment a turn gets from the person's connected accounts. */
export async function connectorEnvFor(owner: string): Promise<Record<string, string>> {
  if (!dbConfigured()) return {};
  const rows = await select<{ provider: string; token_enc: string; label: string | null }>(
    "connectors",
    `owner=eq.${encodeURIComponent(owner)}&select=provider,token_enc,label`,
  ).catch(() => []);
  const env: Record<string, string> = {};
  await Promise.all(
    rows.map(async (row) => {
      if (!isConnectorId(row.provider)) return;
      let grant = readGrant(row.token_enc);
      if (!grant) return;
      if (expiresSoon(grant)) {
        const fresh = await refreshGrant(row.provider, grant).catch(() => null);
        // Refused: the person revoked access or it lapsed. Leave it out; the
        // account still shows as connected until they reconnect or remove it.
        if (!fresh) return;
        grant = fresh;
        await keep(owner, row.provider, grant, row.label ?? "").catch(() => {});
      }
      for (const name of PROVIDERS[row.provider].env) env[name] = grant.a;
      if (row.provider === "vercel" && grant.team) env.VERCEL_TEAM_ID = grant.team;
    }),
  );
  return env;
}
