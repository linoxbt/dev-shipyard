import { CLAIM_COOKIE, openClaims, ownerOf, readCookie } from "@/lib/agent-access/claims.server";

// The wallet behind a request, and what it is linked to on the runner.
//
// Shared by /api/account, the GitHub callback and the push route: all three
// need the same two facts (which wallet signed, which GitHub account it owns)
// and none of them may see the runner token in a browser.

export interface GithubLink {
  id: number;
  login: string;
  linkedAt: number;
}

export interface AccountView {
  wallet: string;
  github: GithubLink | null;
  email: { address: string; verifiedAt: number } | null;
  pendingEmail: string | null;
}

/** The verified wallet behind this request, or null. One signature at
 *  /api/access issues the cookie; see api.access.ts. */
export function grantedOwner(request: Request): string | null {
  return ownerOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
}

function runnerConfig() {
  const e = process.env;
  return { url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""), token: e.RUNNER_TOKEN ?? "" };
}

export async function toAccounts(
  path: string,
  init: RequestInit,
  owner: string,
  caller: string,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> } | null> {
  const cfg = runnerConfig();
  if (!cfg.url || !cfg.token) return null;
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
        authorization: `Bearer ${cfg.token}`,
        "x-devstation-owner": owner,
        "x-devstation-caller": caller,
      },
    });
    const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  }
}

/** What a wallet is linked to, or null when the runner could not be reached. */
export async function accountOf(owner: string, caller: string): Promise<AccountView | null> {
  const result = await toAccounts("/account", { method: "GET" }, owner, caller);
  return result?.ok ? ((result.body.account as AccountView) ?? null) : null;
}

export interface GithubUser {
  id: number;
  login: string;
  avatarUrl: string;
  name: string | null;
}

/** Who a GitHub token belongs to. Null when GitHub rejects it, which is how a
 *  revoked token is told from a working one. */
export async function githubUser(token: string): Promise<GithubUser | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  }).catch(() => null);
  if (!res || !res.ok) return null;
  const u = (await res.json().catch(() => null)) as {
    id?: number;
    login?: string;
    avatar_url?: string;
    name?: string | null;
  } | null;
  if (!u?.id || !u.login) return null;
  return { id: u.id, login: u.login, avatarUrl: u.avatar_url ?? "", name: u.name ?? null };
}
