import { afterEach, describe, expect, it } from "bun:test";
import { branchNameFor, changedFiles, listRepos, openPullRequest, parseRepo } from "./github-repos";

// GitHub is stubbed at fetch, so these assert on the requests actually sent.
// What a pull request is built from matters more than that one came back: a
// tree posted without base_tree would silently delete every file the agent was
// never shown, and a test that only checked the returned URL would pass.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

function stub(responses: Record<string, unknown>, failures: Record<string, string> = {}) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const key = Object.keys(failures).find((k) => url.includes(k) && method !== "GET");
    if (key) {
      return new Response(JSON.stringify({ message: failures[key] }), { status: 422 });
    }
    const match = Object.keys(responses).find((k) => url.includes(k));
    return new Response(JSON.stringify(match ? responses[match] : {}), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const PR_RESPONSES = {
  "/commits/main": { sha: "basecommit", commit: { tree: { sha: "basetree" } } },
  "/git/blobs": { sha: "blobsha" },
  "/git/trees": { sha: "treesha" },
  "/git/commits": { sha: "newcommit" },
  "/git/refs": { ref: "refs/heads/x" },
  "/pulls": { number: 7, html_url: "https://github.com/o/r/pull/7" },
};

describe("naming a repository", () => {
  it("takes owner/name, a URL, or a clone URL", () => {
    for (const input of [
      "linoxbt/dev-shipyard",
      "https://github.com/linoxbt/dev-shipyard",
      "github.com/linoxbt/dev-shipyard.git",
      "https://github.com/linoxbt/dev-shipyard/tree/main",
    ]) {
      expect(parseRepo(input)).toEqual({ owner: "linoxbt", name: "dev-shipyard" });
    }
  });

  it("returns null rather than guessing", () => {
    for (const input of ["", "  ", "not a repo", "https://gitlab.com/a/b", "onlyone"]) {
      expect(parseRepo(input)).toBeNull();
    }
  });
});

describe("naming the branch", () => {
  it("says where it came from and what it was for", () => {
    const name = branchNameFor("fix the failing total() test", new Date("2026-09-11T14:30:00Z"));
    expect(name).toBe("devstation/fix-the-failing-total-test-20260911-143000");
  });

  it("does not collide with an earlier run on the same goal", () => {
    const first = branchNameFor("same goal", new Date("2026-09-11T14:30:00Z"));
    const second = branchNameFor("same goal", new Date("2026-09-11T15:00:00Z"));
    expect(first).not.toBe(second);
  });

  it("still produces a usable name from a goal with nothing to slug", () => {
    expect(branchNameFor("!!! ???", new Date("2026-09-11T14:30:00Z"))).toContain(
      "devstation/change-",
    );
  });
});

describe("working out what changed", () => {
  it("ignores a file rewritten with the same contents", () => {
    const before = { "a.ts": "1", "b.ts": "2" };
    const after = { "a.ts": "1", "b.ts": "changed" };
    expect(changedFiles(before, after)).toEqual({ files: { "b.ts": "changed" }, deleted: [] });
  });

  it("notices a new file and a deleted one", () => {
    const result = changedFiles(
      { "gone.ts": "x", "kept.ts": "y" },
      { "kept.ts": "y", "new.ts": "z" },
    );
    expect(result.files).toEqual({ "new.ts": "z" });
    expect(result.deleted).toEqual(["gone.ts"]);
  });
});

describe("opening a pull request", () => {
  it("builds on the base tree so untouched files survive", async () => {
    const calls = stub(PR_RESPONSES);
    const pr = await openPullRequest(
      "tok",
      "o",
      "r",
      { files: { "src/a.ts": "new" }, message: "fix it", branch: "devstation/x", base: "main" },
      { title: "Fix it", body: "why" },
    );

    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7", branch: "devstation/x" });
    const tree = calls.find((c) => c.url.includes("/git/trees"));
    // Without base_tree, this commit would delete every file the agent was
    // never handed, which is most of a real repository.
    expect(tree?.body?.base_tree).toBe("basetree");
    const commit = calls.find((c) => c.url.includes("/git/commits"));
    expect(commit?.body?.parents).toEqual(["basecommit"]);
  });

  it("creates a new ref and never moves an existing one", async () => {
    const calls = stub(PR_RESPONSES);
    await openPullRequest(
      "tok",
      "o",
      "r",
      { files: { "a.ts": "x" }, message: "m", branch: "devstation/x", base: "main" },
      { title: "t", body: "b" },
    );
    const ref = calls.find((c) => c.url.includes("/git/refs"));
    expect(ref?.method).toBe("POST");
    expect(ref?.body?.ref).toBe("refs/heads/devstation/x");
    // A PATCH to git/refs/heads/... is how a branch gets moved. There is none.
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(calls.some((c) => JSON.stringify(c.body).includes("force"))).toBe(false);
  });

  it("carries a deletion as a null sha", async () => {
    const calls = stub(PR_RESPONSES);
    await openPullRequest(
      "tok",
      "o",
      "r",
      { files: {}, deleted: ["old.ts"], message: "m", branch: "b", base: "main" },
      { title: "t", body: "b" },
    );
    const tree = calls.find((c) => c.url.includes("/git/trees"));
    expect(tree?.body?.tree).toEqual([{ path: "old.ts", mode: "100644", type: "blob", sha: null }]);
  });

  it("says the branch is taken rather than overwriting it", async () => {
    stub(PR_RESPONSES, { "/git/refs": "Reference already exists" });
    await expect(
      openPullRequest(
        "tok",
        "o",
        "r",
        { files: { "a.ts": "x" }, message: "m", branch: "devstation/x", base: "main" },
        { title: "t", body: "b" },
      ),
    ).rejects.toThrow(/already exists.*Nothing was changed/s);
  });

  it("refuses to open a pull request for nothing", async () => {
    const calls = stub(PR_RESPONSES);
    await expect(
      openPullRequest(
        "tok",
        "o",
        "r",
        { files: {}, message: "m", branch: "b", base: "main" },
        { title: "t", body: "b" },
      ),
    ).rejects.toThrow(/no file changed/);
    // And it worked that out before touching GitHub at all.
    expect(calls).toHaveLength(0);
  });

  it("sends the token as a bearer credential and never in the URL", async () => {
    const calls = stub(PR_RESPONSES);
    await openPullRequest(
      "secret-token",
      "o",
      "r",
      { files: { "a.ts": "x" }, message: "m", branch: "b", base: "main" },
      { title: "t", body: "b" },
    );
    expect(calls.every((c) => !c.url.includes("secret-token"))).toBe(true);
    expect(calls.every((c) => c.headers.authorization === "Bearer secret-token")).toBe(true);
  });
});

describe("listing repositories", () => {
  it("leaves out anything the user cannot push to", async () => {
    stub({
      "/user/repos": [
        {
          name: "mine",
          full_name: "me/mine",
          owner: { login: "me" },
          default_branch: "main",
          private: false,
          updated_at: "2026-09-01T00:00:00Z",
          html_url: "u",
          permissions: { push: true },
        },
        {
          name: "read-only",
          full_name: "them/read-only",
          owner: { login: "them" },
          default_branch: "main",
          private: false,
          updated_at: "2026-09-01T00:00:00Z",
          html_url: "u",
          permissions: { push: false },
        },
        {
          name: "archived",
          full_name: "me/archived",
          owner: { login: "me" },
          default_branch: "main",
          private: false,
          updated_at: "2026-09-01T00:00:00Z",
          html_url: "u",
          permissions: { push: true },
          archived: true,
        },
      ],
    });
    const repos = await listRepos("tok");
    expect(repos.map((r) => r.name)).toEqual(["mine"]);
  });
});
