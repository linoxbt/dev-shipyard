// Pushing a generated app to GitHub.
//
// Runs on the SERVER, with an OAuth token from the signed-in session: see
// src/lib/github-oauth.server.ts. Earlier this took a pasted personal access
// token and ran in the browser, which kept the user's own secret off our
// infrastructure. OAuth changes the calculus: the token is issued to this app,
// lives in an httpOnly cookie the page cannot read, and an OAuth token can do
// the two things a fine-grained PAT cannot: create a repository
// (POST /user/repos) and read the signed-in account (GET /user). That is what
// collapses the flow to "connect once, then push".

const API = "https://api.github.com";

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

/** The signed-in account. An OAuth token can always read this, which is why
 *  the owner no longer has to be typed in. */
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
  // An OAuth token with the `repo` scope may create repositories, including
  // private ones: the whole reason sign-in replaced a pasted token here.
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
    if (/Bad credentials|requires authentication/i.test(why)) {
      throw new Error("Your GitHub session has expired. Connect your account again.");
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

  const owner = (await whoami(token)).login;
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
