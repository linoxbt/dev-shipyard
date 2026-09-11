// Working on a repository the user already has, rather than one DevStation
// generated.
//
// The shape deliberately mirrors the outward-tool rule the rest of the agent
// is built on: the token lives in the signed-in session on the server and
// never travels to the runner. The agent receives text files and returns
// edited text files. Everything that touches GitHub happens here, on the
// person's behalf, after they have approved it.
//
// Changed files are committed on top of the base commit rather than the whole
// tree being replaced. That is what makes it safe to hand the agent a subset
// of the repository: anything it never saw, including every binary file and
// anything over the size cap, is carried through untouched because the commit
// builds on the base tree.

const API = "https://api.github.com";

export interface RepoSummary {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
  url: string;
}

export interface BranchPoint {
  branch: string;
  commitSha: string;
  treeSha: string;
}

export interface PullRequest {
  number: number;
  url: string;
  branch: string;
}

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
    throw new Error(body?.message || `GitHub request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** Split "owner/name", a GitHub URL, or a clone URL into its two parts.
 *
 *  People paste all three, and guessing wrong means working on a repository
 *  they did not mean. */
export function parseRepo(input: string): { owner: string; name: string } | null {
  const text = input.trim().replace(/\.git$/, "");
  if (!text) return null;
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/?#]+)/i.exec(text);
  const plain = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/.exec(text);
  const match = url ?? plain;
  if (!match) return null;
  const [, owner, name] = match;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { owner, name };
}

/** The repositories the signed-in account can push to, most recently touched
 *  first. Read access alone is not enough: a pull request needs a branch. */
export async function listRepos(token: string, limit = 100): Promise<RepoSummary[]> {
  const raw = await gh<
    Array<{
      name: string;
      full_name: string;
      owner: { login: string };
      default_branch: string;
      private: boolean;
      updated_at: string;
      html_url: string;
      permissions?: { push?: boolean };
      archived?: boolean;
    }>
  >(
    token,
    `/user/repos?per_page=${Math.min(limit, 100)}&sort=updated&affiliation=owner,collaborator,organization_member`,
  );

  return raw
    .filter((r) => r.permissions?.push !== false && !r.archived)
    .map((r) => ({
      owner: r.owner.login,
      name: r.name,
      fullName: r.full_name,
      defaultBranch: r.default_branch || "main",
      private: r.private,
      updatedAt: r.updated_at,
      url: r.html_url,
    }));
}

export async function getRepo(token: string, owner: string, name: string): Promise<RepoSummary> {
  const r = await gh<{
    name: string;
    full_name: string;
    owner: { login: string };
    default_branch: string;
    private: boolean;
    updated_at: string;
    html_url: string;
  }>(token, `/repos/${owner}/${name}`);
  return {
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch || "main",
    private: r.private,
    updatedAt: r.updated_at,
    url: r.html_url,
  };
}

/** The repository as a gzipped tar of one ref. One request instead of a blob
 *  per file, which matters on rate limits well before it matters on latency. */
export async function fetchTarball(
  token: string,
  owner: string,
  name: string,
  ref: string,
): Promise<Buffer> {
  const res = await fetch(`${API}/repos/${owner}/${name}/tarball/${encodeURIComponent(ref)}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Could not download ${owner}/${name} at ${ref} (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Where a branch starts from: the tip commit of `ref` and its tree. */
export async function baseFor(
  token: string,
  owner: string,
  name: string,
  ref: string,
): Promise<BranchPoint> {
  const commit = await gh<{ sha: string; commit: { tree: { sha: string } } }>(
    token,
    `/repos/${owner}/${name}/commits/${encodeURIComponent(ref)}`,
  );
  return { branch: ref, commitSha: commit.sha, treeSha: commit.commit.tree.sha };
}

/** A branch name that says where it came from and cannot collide with a
 *  previous run on the same goal. */
export function branchNameFor(goal: string, now = new Date()): string {
  const slug =
    goal
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "change";
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  return `devstation/${slug}-${stamp}`;
}

export interface ProposedChange {
  /** Only what changed. Everything else comes through from the base tree. */
  files: Record<string, string>;
  deleted?: string[];
  message: string;
  branch: string;
  base: string;
}

/**
 * Commit the change onto a new branch and open a pull request for it.
 *
 * Nothing is force-pushed and no existing branch is moved: if the branch name
 * is taken, this fails and says so rather than overwriting whatever was there.
 */
export async function openPullRequest(
  token: string,
  owner: string,
  name: string,
  change: ProposedChange,
  pull: { title: string; body: string },
): Promise<PullRequest> {
  const paths = Object.keys(change.files);
  if (paths.length === 0 && (change.deleted?.length ?? 0) === 0) {
    throw new Error("There is nothing to open a pull request for: no file changed.");
  }

  const repo = `/repos/${owner}/${name}`;
  const base = await baseFor(token, owner, name, change.base);

  const blobs = await Promise.all(
    paths.map(async (path) => {
      const blob = await gh<{ sha: string }>(token, `${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: change.files[path], encoding: "utf-8" }),
      });
      return { path, mode: "100644" as const, type: "blob" as const, sha: blob.sha };
    }),
  );

  // A null sha removes the path. This is the only way a deletion reaches the
  // tree, and it is why deletions have to be carried separately rather than
  // inferred from a file's absence: the agent is only ever given part of the
  // repository, so absence means nothing.
  const removals = (change.deleted ?? []).map((path) => ({
    path,
    mode: "100644" as const,
    type: "blob" as const,
    sha: null,
  }));

  const tree = await gh<{ sha: string }>(token, `${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: base.treeSha, tree: [...blobs, ...removals] }),
  });

  const commit = await gh<{ sha: string }>(token, `${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: change.message,
      tree: tree.sha,
      parents: [base.commitSha],
    }),
  });

  try {
    await gh(token, `${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${change.branch}`, sha: commit.sha }),
    });
  } catch (error) {
    const why = error instanceof Error ? error.message : "";
    if (/Reference already exists/i.test(why)) {
      throw new Error(
        `A branch called ${change.branch} already exists. Nothing was changed; pick another name.`,
      );
    }
    throw error;
  }

  const created = await gh<{ number: number; html_url: string }>(token, `${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: pull.title,
      body: pull.body,
      head: change.branch,
      base: change.base,
    }),
  });

  return { number: created.number, url: created.html_url, branch: change.branch };
}

/** What the agent changed, worked out by comparing against what it was given.
 *
 *  Computed rather than trusted: the agent reports the files it wrote, but a
 *  file it wrote with identical contents is not a change and does not belong
 *  in a pull request. */
export function changedFiles(
  before: Record<string, string>,
  after: Record<string, string>,
): { files: Record<string, string>; deleted: string[] } {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(after)) {
    if (before[path] !== content) files[path] = content;
  }
  const deleted = Object.keys(before).filter((path) => !(path in after));
  return { files, deleted };
}
