import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { MockProvider } from "../providers";
import { repoCommand } from "./repo-command";
import type { CommandContext, Terminal } from "./commands";

// GitHub is stubbed; everything else is real. The workspace is written to
// disk, the agent edits it, and what comes back is compared against what went
// in, which is the part worth getting right: a pull request built from the
// agent's own report rather than from the files would be confidently wrong.

const realFetch = globalThis.fetch;
const dirs: string[] = [];
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "repocmd-"));
  dirs.push(root);
  return root;
}

function terminal(answers: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const t: Terminal = {
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    ask: async () => answers.shift() ?? "",
    colour: false,
  };
  return { t, text: () => out.join("\n"), errors: () => err.join("\n") };
}

// --- a tar the reader will accept ------------------------------------------

const BLOCK = 512;
function tarEntry(name: string, content: string): Buffer {
  const body = Buffer.from(content, "utf8");
  const header = Buffer.alloc(BLOCK);
  header.write(name, 0, "utf8");
  header.write("000644 \0", 100);
  header.write(`${body.length.toString(8).padStart(11, "0")} `, 124);
  header.write("        ", 148);
  header.write("0", 156);
  header.write("ustar\0" + "00", 257);
  const padding = (BLOCK - (body.length % BLOCK)) % BLOCK;
  return Buffer.concat([header, body, Buffer.alloc(padding)]);
}

function tarball(files: Record<string, string>): Buffer {
  const parts = Object.entries(files).map(([p, c]) => tarEntry(`owner-repo-abc1234/${p}`, c));
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(BLOCK * 2)]));
}

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
}

function stubGithub(files: Record<string, string>, over: Record<string, unknown> = {}) {
  const calls: Call[] = [];
  const responses: Record<string, unknown> = {
    "/repos/owner/repo": {
      name: "repo",
      full_name: "owner/repo",
      owner: { login: "owner" },
      default_branch: "main",
      private: false,
      updated_at: "2026-09-01T00:00:00Z",
      html_url: "https://github.com/owner/repo",
    },
    "/repos/owner/repo/commits/main": { sha: "basecommit", commit: { tree: { sha: "basetree" } } },
    "/repos/owner/repo/git/blobs": { sha: "blob" },
    "/repos/owner/repo/git/trees": { sha: "tree" },
    "/repos/owner/repo/git/commits": { sha: "commit" },
    "/repos/owner/repo/git/refs": {},
    "/repos/owner/repo/pulls": { number: 12, html_url: "https://github.com/owner/repo/pull/12" },
    ...over,
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
    });
    if (url.includes("/tarball/")) {
      return new Response(new Uint8Array(tarball(files)), { status: 200 });
    }
    // Longest match wins, so /repos/owner/repo does not shadow /repos/owner/repo/pulls.
    const key = Object.keys(responses)
      .filter((k) => url.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    const value = key ? responses[key] : {};
    if (typeof value === "number") return new Response("{}", { status: value });
    return new Response(JSON.stringify(value), { status: 200 });
  }) as typeof fetch;

  return calls;
}

const REPO = {
  "package.json": '{ "name": "demo" }\n',
  "src/total.js": "export const total = (i) => i.length;\n",
  "README.md": "# demo\n",
};

function context(root: string, provider: MockProvider, t: Terminal): CommandContext {
  return { root, terminal: t, provider, maxSteps: 20 };
}

function fixing(): MockProvider {
  return new MockProvider([
    {
      toolCalls: [
        {
          id: "1",
          name: "write_file",
          input: { path: "src/total.js", content: "export const total = (i) => i.length + 1;\n" },
        },
      ],
    },
    { text: "Adjusted total()." },
  ]);
}

describe("working on a real repository", () => {
  it("fetches it, edits it, and opens a pull request once approved", async () => {
    const root = scratch();
    const calls = stubGithub(REPO);
    const term = terminal();

    const result = await repoCommand(context(root, fixing(), term.t), "owner/repo", "add one", {
      token: "tok",
      confirm: async () => true,
      now: new Date("2026-09-11T15:00:00Z"),
    });

    expect(result.code).toBe(0);
    expect(result.pullRequestUrl).toBe("https://github.com/owner/repo/pull/12");
    expect(result.changed).toEqual(["src/total.js"]);
    expect(term.text()).toContain("Opened https://github.com/owner/repo/pull/12");

    // Only the file that actually differs is in the commit.
    const tree = calls.find((c) => c.url.includes("/git/trees"));
    expect(tree?.body?.base_tree).toBe("basetree");
    expect((tree?.body?.tree as Array<{ path: string }>).map((t) => t.path)).toEqual([
      "src/total.js",
    ]);

    const ref = calls.find((c) => c.url.includes("/git/refs"));
    expect(String(ref?.body?.ref)).toBe("refs/heads/devstation/add-one-20260911-150000");
  }, 60_000);

  it("leaves the workspace on disk to look at", async () => {
    const root = scratch();
    stubGithub(REPO);
    const result = await repoCommand(
      context(root, fixing(), terminal().t),
      "owner/repo",
      "add one",
      { token: "tok", confirm: async () => true },
    );
    expect(result.workspace).toBeDefined();
    expect(readFileSync(join(result.workspace!, "src/total.js"), "utf8")).toContain("length + 1");
    // And it ignores itself, so it cannot end up committed to whatever
    // directory this was run from.
    expect(readFileSync(join(root, ".devstation", ".gitignore"), "utf8").trim()).toBe("*");
  }, 60_000);

  it("opens nothing when the person says no", async () => {
    const root = scratch();
    const calls = stubGithub(REPO);
    const term = terminal();
    const result = await repoCommand(context(root, fixing(), term.t), "owner/repo", "add one", {
      token: "tok",
      confirm: async () => false,
    });

    expect(result.pullRequestUrl).toBeUndefined();
    expect(calls.some((c) => c.url.includes("/pulls"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/git/refs"))).toBe(false);
    expect(term.text()).toContain("Not opened");
    // The work is not thrown away just because it was not published.
    expect(existsSync(join(result.workspace!, "src/total.js"))).toBe(true);
  }, 60_000);

  it("treats an unanswered prompt as a no", async () => {
    const root = scratch();
    const calls = stubGithub(REPO);
    // No confirm injected and no answers queued: ask() returns "".
    await repoCommand(context(root, fixing(), terminal().t), "owner/repo", "add one", {
      token: "tok",
    });
    expect(calls.some((c) => c.url.includes("/pulls"))).toBe(false);
  }, 60_000);

  it("does not open an empty pull request when nothing changed", async () => {
    const root = scratch();
    const calls = stubGithub(REPO);
    const term = terminal();
    // The agent writes the file back exactly as it found it.
    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "write_file",
            input: { path: "src/total.js", content: REPO["src/total.js"] },
          },
        ],
      },
      { text: "Nothing needed changing." },
    ]);

    const result = await repoCommand(context(root, provider, term.t), "owner/repo", "look at it", {
      token: "tok",
      confirm: async () => true,
    });

    expect(result.changed).toEqual([]);
    expect(term.text()).toContain("Nothing changed");
    expect(calls.some((c) => c.url.includes("/pulls"))).toBe(false);
  }, 60_000);

  it("never writes a credential into the workspace", async () => {
    const root = scratch();
    stubGithub(REPO);
    const result = await repoCommand(
      context(root, fixing(), terminal().t),
      "owner/repo",
      "add one",
      { token: "hunter2-secret-token", confirm: async () => true },
    );

    const config = readFileSync(join(result.workspace!, ".git", "config"), "utf8");
    expect(config).not.toContain("hunter2-secret-token");
    expect(config).not.toContain("url =");
  }, 60_000);

  it("says so when the repository cannot be named", async () => {
    const term = terminal();
    const result = await repoCommand(
      context(scratch(), fixing(), term.t),
      "not a repo at all",
      "goal",
      { token: "tok" },
    );
    expect(result.code).toBe(2);
    expect(term.errors()).toContain("owner/name");
  });

  it("asks for a goal rather than inventing one", async () => {
    const term = terminal();
    const result = await repoCommand(context(scratch(), fixing(), term.t), "owner/repo", "  ", {
      token: "tok",
    });
    expect(result.code).toBe(2);
    expect(term.errors()).toContain("Say what to do");
  });

  it("reports a failure from GitHub and keeps the work", async () => {
    const root = scratch();
    stubGithub(REPO, { "/repos/owner/repo/git/refs": 422 });
    const term = terminal();
    const result = await repoCommand(context(root, fixing(), term.t), "owner/repo", "add one", {
      token: "tok",
      confirm: async () => true,
    });

    expect(result.code).toBe(1);
    expect(term.errors()).toContain("was not opened");
    expect(term.errors()).toContain("Nothing was changed on GitHub");
    expect(existsSync(join(result.workspace!, "src/total.js"))).toBe(true);
  }, 60_000);
});

describe("the agent naming its own pull request", () => {
  it("uses the title it wrote, not the first line of its closing message", async () => {
    // Found on a live run: the agent signed off with "Both tests pass now.",
    // which became the pull request title and said nothing about the change.
    const root = scratch();
    const calls = stubGithub(REPO);
    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "write_file",
            input: { path: "src/total.js", content: "export const total = (i) => i.length + 1;\n" },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "2",
            name: "open_pull_request",
            input: {
              title: "Count each item once more",
              body: "Because the length was off by one.",
            },
          },
        ],
      },
      { text: "Both tests pass now." },
    ]);

    await repoCommand(context(root, provider, terminal().t), "owner/repo", "add one", {
      token: "tok",
      confirm: async () => true,
    });

    const pull = calls.find((c) => c.url.endsWith("/pulls"));
    expect(pull?.body?.title).toBe("Count each item once more");
    expect(String(pull?.body?.body)).toContain("Because the length was off by one.");
    // The facts about the run are still stated by us, under the agent's words.
    expect(String(pull?.body?.body)).toContain("DevStation coding agent");
  }, 60_000);

  it("records the proposal without opening anything", async () => {
    const root = scratch();
    const calls = stubGithub(REPO);
    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "write_file",
            input: { path: "src/total.js", content: "export const total = (i) => i.length + 1;\n" },
          },
        ],
      },
      {
        toolCalls: [{ id: "2", name: "open_pull_request", input: { title: "T", body: "B" } }],
      },
      { text: "done" },
    ]);

    // The person says no, after the agent asked for a pull request.
    await repoCommand(context(root, provider, terminal().t), "owner/repo", "add one", {
      token: "tok",
      confirm: async () => false,
    });
    expect(calls.some((c) => c.url.endsWith("/pulls"))).toBe(false);
    expect(calls.some((c) => c.url.includes("/git/refs"))).toBe(false);

    // And the agent was told plainly that it had not happened.
    const told = provider.calls[2].messages.find(
      (m) => m.role === "tool" && String(m.content).includes("has been put to the user"),
    );
    expect(told).toBeDefined();
    expect(String((told as { content: string }).content)).toContain("do not describe it as done");
  }, 60_000);

  it("falls back to the derived title when the agent never asked", async () => {
    const root = scratch();
    const calls = stubGithub(REPO);
    await repoCommand(context(root, fixing(), terminal().t), "owner/repo", "add one", {
      token: "tok",
      confirm: async () => true,
    });
    const pull = calls.find((c) => c.url.endsWith("/pulls"));
    // The goal, not the sign-off: "Adjusted total()." reports an outcome.
    expect(pull?.body?.title).toBe("add one");
  }, 60_000);
});
