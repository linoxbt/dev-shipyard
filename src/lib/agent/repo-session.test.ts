import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { changedFiles } from "../github-repos";
import { MockProvider } from "./providers";
import { Orchestrator, type RunResult } from "./orchestrator";
import { Workspace } from "./workspace";
import { initLocalRepo, materialise, proposalFor, readWorkspace } from "./repo-session";
import { runShell } from "./shell";

const dirs: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "repo-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("writing a repository into a workspace", () => {
  it("writes nested files and reports the count", () => {
    const root = scratch();
    const result = materialise(
      { "src/index.ts": "export const a = 1;\n", "README.md": "# hi\n" },
      root,
    );
    expect(result.written).toBe(2);
    expect(result.refused).toEqual([]);
    expect(readFileSync(join(root, "src/index.ts"), "utf8")).toContain("export const a");
  });

  it("refuses a credentials file and says which one, rather than writing it", () => {
    // A repository can legitimately contain .env.example, but the workspace
    // rule is the same one that stops the agent reading secrets, and a silent
    // drop would leave it wondering why a file it can see in the listing is
    // not there.
    const root = scratch();
    const result = materialise({ ".env": "SECRET=1\n", "ok.ts": "x" }, root);
    expect(result.written).toBe(1);
    expect(result.refused[0].path).toBe(".env");
    expect(existsSync(join(root, ".env"))).toBe(false);
  });

  it("refuses a path that would escape the workspace", () => {
    const root = scratch();
    const result = materialise({ "../escaped.ts": "x" }, root);
    expect(result.written).toBe(0);
    expect(result.refused[0].why).toContain("outside the workspace");
  });
});

describe("reading the workspace back", () => {
  it("returns text files and leaves out the noise", () => {
    const root = scratch();
    materialise({ "a.ts": "1", "nested/b.ts": "2" }, root);
    mkdirSync(join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(root, "node_modules/pkg/index.js"), "noise");
    writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x00, 0x01]));

    const files = readWorkspace(root);
    expect(Object.keys(files).sort()).toEqual(["a.ts", "nested/b.ts"]);
  });

  it("does not follow a symlink out of the tree", () => {
    const root = scratch();
    const outside = scratch();
    writeFileSync(join(outside, "secret.txt"), "not yours");
    materialise({ "a.ts": "1" }, root);
    symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

    const files = readWorkspace(root);
    expect(Object.keys(files)).toEqual(["a.ts"]);
  });

  it("leaves out .git, so the agent's own checkpoints never reach a pull request", async () => {
    const root = scratch();
    materialise({ "a.ts": "1" }, root);
    await initLocalRepo(root, "main");
    expect(existsSync(join(root, ".git"))).toBe(true);
    expect(Object.keys(readWorkspace(root))).toEqual(["a.ts"]);
  }, 30_000);
});

describe("the local repository the agent works in", () => {
  it("has a first commit to check point against, and no remote to push to", async () => {
    const root = scratch();
    materialise({ "a.ts": "1" }, root);
    expect(await initLocalRepo(root, "main")).toBe(true);

    const log = await runShell("git log --oneline", { cwd: root });
    expect(log.stdout).toContain("base: main");
    // No remote means no accidental push, whatever the agent runs.
    const remotes = await runShell("git remote -v", { cwd: root });
    expect(remotes.stdout.trim()).toBe("");
  }, 30_000);

  it("holds no credential anywhere in it", async () => {
    const root = scratch();
    materialise({ "a.ts": "1" }, root);
    await initLocalRepo(root, "main");
    const config = readFileSync(join(root, ".git", "config"), "utf8");
    expect(config).not.toContain("http");
    expect(config).not.toContain("token");
    expect(config).not.toContain("@github.com");
  }, 30_000);
});

describe("what comes back out", () => {
  it("is the change the agent actually made, and nothing else", async () => {
    const root = scratch();
    const before = {
      "src/total.js": "export const total = (i) => i.length;\n",
      "README.md": "# demo\n",
    };
    materialise(before, root);
    await initLocalRepo(root, "main");

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
      { text: "Adjusted total()." },
    ]);
    const result = await new Orchestrator({ provider, workspace: new Workspace(root) }).run(
      "change total",
    );
    expect(result.ok).toBe(true);

    const change = changedFiles(before, readWorkspace(root));
    expect(Object.keys(change.files)).toEqual(["src/total.js"]);
    // README was never touched, so it is not in the pull request at all.
    expect(change.files["README.md"]).toBeUndefined();
    expect(change.deleted).toEqual([]);
  }, 30_000);

  it("reports no change when the agent rewrote a file with the same contents", async () => {
    const root = scratch();
    const before = { "a.ts": "same\n" };
    materialise(before, root);
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.ts", content: "same\n" } }] },
      { text: "done" },
    ]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("touch it");

    // The orchestrator reports a.ts as written; the diff is what decides.
    const change = changedFiles(before, readWorkspace(root));
    expect(change.files).toEqual({});
  }, 30_000);
});

describe("what the pull request says", () => {
  const result = (over: Partial<RunResult> = {}): RunResult => ({
    ok: true,
    summary: "Fixed total() so it multiplies price by quantity.",
    steps: 4,
    filesChanged: ["src/total.js"],
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    },
    costUsd: 0.04,
    messages: [],
    stoppedBecause: "finished",
    handoffs: [],
    ...over,
  });

  it("titles the change from the goal, not from the sign-off", () => {
    // "Fixed total()..." is a report that it worked. A pull request title
    // should say what the change is. Live runs produced "Both tests pass now."
    // and "Done. Summary:" before this changed.
    const proposal = proposalFor("fix the test", result(), ["src/total.js"]);
    expect(proposal.title).toBe("fix the test");
    expect(proposal.body).toContain("**Asked for:** fix the test");
    expect(proposal.body).toContain("Fixed total() so it multiplies price by quantity.");
    expect(proposal.body).toContain("`src/total.js`");
  });

  it("keeps the title to one short line", () => {
    const long = "a".repeat(200);
    const proposal = proposalFor(`${long}\nsecond line`, result(), []);
    expect(proposal.title.length).toBeLessThanOrEqual(72);
    expect(proposal.title).not.toContain("\n");
  });

  it("falls back to the summary when there is no goal to use", () => {
    const proposal = proposalFor("", result(), []);
    expect(proposal.title).toBe("Fixed total() so it multiplies price by quantity.");
  });

  it("says who opened it and that it has not been reviewed", () => {
    const proposal = proposalFor("goal", result(), ["a.ts"]);
    expect(proposal.body).toContain("DevStation coding agent");
    expect(proposal.body).toContain("nothing here has been merged");
  });

  it("does not claim files changed when none did", () => {
    expect(proposalFor("goal", result(), []).body).toContain("No files changed");
  });
});
