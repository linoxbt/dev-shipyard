// Accounts a person connects so the agent can act as them: GitHub, Vercel,
// Netlify, Railway and Supabase.
//
// A token is checked against the provider before it is kept (so a typo is
// caught at once), then stored encrypted (AES-256-GCM, key derived from
// SESSION_SECRET or RUNNER_TOKEN) in the connectors table, which only this
// server can reach. Each message the person sends carries their tokens to
// their own sandbox for that turn, as the variables the providers' CLIs read
// (services/runner CONNECTOR_VARS); the browser never sees one again.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { dbConfigured, insert, remove, select } from "./admin.server";

export type ConnectorId = "github" | "vercel" | "netlify" | "railway" | "supabase";

interface Provider {
  id: ConnectorId;
  /** Environment variables the token is given to the sandbox as. */
  env: string[];
  /** Who the token belongs to, or null when the provider refused it. */
  whoami: (token: string) => Promise<string | null>;
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
    whoami: async (token) => {
      const me = await json(
        await fetch("https://api.vercel.com/v2/user", {
          headers: { authorization: `Bearer ${token}` },
          signal: t(),
        }),
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
      const res = await fetch("https://api.supabase.com/v1/projects", {
        headers: { authorization: `Bearer ${token}` },
        signal: t(),
      });
      if (!res.ok) return null;
      const projects = (await res.json()) as unknown[];
      return `${projects.length} project${projects.length === 1 ? "" : "s"}`;
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

/** Check the token with the provider, then keep it. */
export async function saveConnector(
  owner: string,
  provider: ConnectorId,
  token: string,
): Promise<{ ok: true; label: string } | { ok: false; message: string }> {
  const clean = token.trim();
  if (clean.length < 8 || clean.length > 2000 || /\s/.test(clean)) {
    return { ok: false, message: "That does not look like a token." };
  }
  let label: string | null;
  try {
    label = await PROVIDERS[provider].whoami(clean);
  } catch {
    return { ok: false, message: "The provider could not be reached. Try again in a moment." };
  }
  if (!label) return { ok: false, message: "The provider did not accept that token." };
  await insert(
    "connectors",
    { owner, provider, token_enc: sealToken(clean), label, created_at: new Date().toISOString() },
    { upsertOn: "owner,provider" },
  );
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
  const rows = await select<{ provider: string; token_enc: string }>(
    "connectors",
    `owner=eq.${encodeURIComponent(owner)}&select=provider,token_enc`,
  ).catch(() => []);
  const env: Record<string, string> = {};
  for (const row of rows) {
    if (!isConnectorId(row.provider)) continue;
    const token = openToken(row.token_enc);
    if (!token) continue;
    for (const name of PROVIDERS[row.provider].env) env[name] = token;
  }
  return env;
}
