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

export async function whoami(token: string): Promise<GithubUser> {
  const u = await gh<{ login: string; avatar_url: string }>(token, "/user");
  return { login: u.login, avatarUrl: u.avatar_url };
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
  name: string,
  isPrivate: boolean,
): Promise<{ owner: string; name: string; url: string; defaultBranch: string; empty: boolean }> {
  const me = await whoami(token);
  const existing = await fetch(`${API}/repos/${me.login}/${name}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
  });
  if (existing.ok) {
    const r = (await existing.json()) as { default_branch: string; html_url: string; size: number };
    return {
      owner: me.login,
      name,
      url: r.html_url,
      defaultBranch: r.default_branch || "main",
      // A repo with no commits has no ref to build a parent from, so the first
      // commit has to be parentless. GitHub reports that as size 0.
      empty: r.size === 0,
    };
  }
  const created = await gh<{ default_branch: string; html_url: string }>(token, "/user/repos", {
    method: "POST",
    body: JSON.stringify({
      name,
      private: isPrivate,
      description: "Built with DevStation",
      auto_init: false,
    }),
  });
  return {
    owner: me.login,
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

  const repo = await ensureRepo(token, params.repoName, params.isPrivate);
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
