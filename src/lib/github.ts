// Pushing a generated app to GitHub.
//
// The token goes from the BROWSER straight to api.github.com. It never reaches
// DevStation's servers, its logs, or the Netlify function — verified against
// the live API, which returns `access-control-allow-origin: *` and permits the
// Authorization header. A server proxy would work too, but it would put the
// user's GitHub credential through our infrastructure for no benefit.
//
// The trade-off is that the token lives in browser storage and is therefore
// exposed to anything that can run script on the page. That is why the stored
// value is scoped per wallet and why a fine-grained PAT is what the UI asks
// for: its blast radius is the repos the user granted it, not their account.

const API = "https://api.github.com";
const STORAGE_KEY = "devstation-github-token-v1";

export interface GithubUser {
  login: string;
  avatarUrl: string;
}

export interface PushTarget {
  owner: string;
  name: string;
  url: string;
  pushedAt: number;
}

// --- token storage ---------------------------------------------------------
// Keyed per wallet: switching accounts in one browser must not hand the new
// wallet the previous one's GitHub credential.

function readAll(): Record<string, string> {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function readToken(wallet: string | undefined): string {
  if (!wallet) return "";
  return readAll()[wallet.toLowerCase()] ?? "";
}

export function writeToken(wallet: string, token: string): void {
  if (typeof localStorage === "undefined") return;
  const all = readAll();
  if (token) all[wallet.toLowerCase()] = token;
  else delete all[wallet.toLowerCase()];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* a full or blocked store must not break the page */
  }
}

// --- API -------------------------------------------------------------------

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    // GitHub's own message is the useful one ("Bad credentials", "name already
    // exists on this account"); a generic "request failed" would send the user
    // hunting for a problem GitHub already named.
    throw new Error(body?.message || `GitHub request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** The signed-in account, or null when the token may not read it.
 *
 *  GET /user is NOT available to fine-grained tokens (confirmed against
 *  GitHub's own OpenAPI spec: enabledForGitHubApps false). Fine-grained is the
 *  token type this UI recommends, so failing here would break the common case;
 *  the owner is asked for instead. Classic tokens still resolve it themselves. */
export async function whoami(token: string): Promise<GithubUser | null> {
  try {
    const u = await gh<{ login: string; avatar_url: string }>(token, "/user");
    return { login: u.login, avatarUrl: u.avatar_url };
  } catch {
    return null;
  }
}

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  isPrivate: boolean;
  url: string;
  /** Empty repos have no ref to commit onto, so the first commit is parentless. */
  empty: boolean;
}

/** Every repository this token can actually reach.
 *
 *  Fine-grained tokens are scoped to SELECTED repositories, and GitHub returns
 *  404 — not 403 — for one outside that selection. That is indistinguishable
 *  from "does not exist", which is exactly the confusion this list removes: if
 *  a repo is missing here, the token was not granted it, however real it is.
 *
 *  Two endpoints because the token types disagree (checked against GitHub's
 *  OpenAPI description): /installation/repositories is the fine-grained one and
 *  /user/repos is refused, while a classic token is the other way round. */
export async function listRepos(token: string): Promise<RepoSummary[]> {
  const shape = (r: {
    name: string;
    full_name: string;
    private: boolean;
    html_url: string;
    size: number;
    owner?: { login: string };
  }): RepoSummary => ({
    owner: r.owner?.login ?? r.full_name.split("/")[0],
    name: r.name,
    fullName: r.full_name,
    isPrivate: r.private,
    url: r.html_url,
    empty: r.size === 0,
  });

  try {
    const res = await gh<{ repositories: Parameters<typeof shape>[0][] }>(
      token,
      "/installation/repositories?per_page=100",
    );
    if (Array.isArray(res.repositories)) return res.repositories.map(shape);
  } catch {
    /* not a fine-grained token — fall through to the classic endpoint */
  }
  try {
    const res = await gh<Parameters<typeof shape>[0][]>(
      token,
      "/user/repos?per_page=100&sort=updated",
    );
    return Array.isArray(res) ? res.map(shape) : [];
  } catch {
    return [];
  }
}

/** Turn a project name into something GitHub will accept as a repo name. */
export function repoNameFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 90);
  return slug || "devstation-app";
}

async function ensureRepo(
  token: string,
  owner: string,
  name: string,
  isPrivate: boolean,
): Promise<{ owner: string; name: string; url: string; defaultBranch: string; empty: boolean }> {
  const existing = await fetch(`${API}/repos/${owner}/${name}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (existing.ok) {
    const r = (await existing.json()) as { default_branch: string; html_url: string; size: number };
    return {
      owner,
      name,
      url: r.html_url,
      defaultBranch: r.default_branch || "main",
      // A repo with no commits has no ref to build a parent from, so the first
      // commit has to be parentless. GitHub reports that as size 0.
      empty: r.size === 0,
    };
  }
  // Creating a repository is NOT available to fine-grained tokens
  // (POST /user/repos, enabledForGitHubApps false). Rather than surface
  // GitHub's opaque "Resource not accessible by personal access token", say
  // which of the two ways forward applies.
  let created: { default_branch: string; html_url: string };
  try {
    created = await gh<{ default_branch: string; html_url: string }>(token, "/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name,
        private: isPrivate,
        description: "Built with DevStation",
        auto_init: false,
      }),
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : "";
    if (/not accessible|Not Found|Bad credentials/i.test(why)) {
      throw new Error(
        `This token cannot see ${owner}/${name}, and cannot create it either. GitHub returns the ` +
          `same 404 whether a repository does not exist OR the token was not granted access to ` +
          `it — so if you just created it, the likely cause is that your fine-grained token's ` +
          `repository list does not include it. Pick from the list above, add ${name} to the ` +
          `token at github.com/settings/tokens, or use a classic token with the "repo" scope.`,
      );
    }
    throw e;
  }
  return {
    owner,
    name,
    url: created.html_url,
    defaultBranch: created.default_branch || "main",
    empty: true,
  };
}

/** Push an app as ONE commit.
 *
 *  Uses the Git Data API (blobs -> tree -> commit -> ref) rather than the
 *  Contents API, which would produce a separate commit per file and turn a
 *  twenty-file app into twenty commits of noise. */
export async function pushApp(params: {
  token: string;
  /** GitHub account or org that owns the repo. Required for fine-grained
   *  tokens, which cannot look the account up themselves. */
  owner?: string;
  repoName: string;
  isPrivate: boolean;
  files: Record<string, string>;
  message?: string;
}): Promise<PushTarget> {
  const { token, files } = params;
  const entries = Object.entries(files).map(([path, content]) => [
    // Generated apps live under app/ in the workspace; the repo root should be
    // the app itself, not a folder containing it.
    path.replace(/^app\//, ""),
    content,
  ]) as Array<[string, string]>;
  if (entries.length === 0) throw new Error("There is nothing to push yet.");

  const owner = params.owner?.trim() || (await whoami(token))?.login;
  if (!owner) {
    throw new Error(
      "Enter your GitHub username — this token cannot read your account, which is normal for a " +
        "fine-grained token.",
    );
  }
  const repo = await ensureRepo(token, owner, params.repoName, params.isPrivate);
  const base = `/repos/${repo.owner}/${repo.name}`;

  const blobs = await Promise.all(
    entries.map(async ([path, content]) => {
      const blob = await gh<{ sha: string }>(token, `${base}/git/blobs`, {
        method: "POST",
        // utf-8 rather than base64: these are source files, and it keeps the
        // request readable if it ever has to be debugged.
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      return { path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
    }),
  );

  const tree = await gh<{ sha: string }>(token, `${base}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: blobs }),
  });

  let parents: string[] = [];
  if (!repo.empty) {
    const ref = await fetch(`${API}${base}/git/ref/heads/${repo.defaultBranch}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
    });
    if (ref.ok) {
      const r = (await ref.json()) as { object: { sha: string } };
      parents = [r.object.sha];
    }
  }

  const commit = await gh<{ sha: string }>(token, `${base}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: params.message || "Update from DevStation",
      tree: tree.sha,
      parents,
    }),
  });

  const refPath = `${base}/git/refs/heads/${repo.defaultBranch}`;
  const updated = await fetch(`${API}${refPath}`, {
    method: "PATCH",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });
  if (!updated.ok) {
    // A brand-new repo has no branch ref to move, so it has to be created.
    await gh(token, `${base}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${repo.defaultBranch}`, sha: commit.sha }),
    });
  }

  return { owner: repo.owner, name: repo.name, url: repo.url, pushedAt: Date.now() };
}
