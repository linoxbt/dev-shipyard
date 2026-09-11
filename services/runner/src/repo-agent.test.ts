import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../../../src/lib/agent/providers";
import {
  cancelRepoJob,
  changeFor,
  getRepoJob,
  startRepoJob,
  viewOf,
  whenSettled,
} from "./repo-agent";

// The whole job, offline. The model is scripted, but the workspace, the git
// repository and the diff are all real, because those are the parts that decide
// what ends up in somebody's pull request.

const dirs: string[] = [];
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-job-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const REPO = {
  "package.json": '{ "name": "demo" }\n',
  "src/total.js": "export const total = (i) => i.length;\n",
  "README.md": "# demo\n",
};

function editing(content = "export const total = (i) => i.length + 1;\n"): MockProvider {
  return new MockProvider([
    { toolCalls: [{ id: "1", name: "write_file", input: { path: "src/total.js", content } }] },
    { text: "Adjusted total()." },
  ]);
}

async function runJob(provider: MockProvider, files = REPO) {
  const job = startRepoJob({
    repo: "owner/demo",
    ref: "main",
    goal: "add one",
    files,
    provider,
    stateDir: stateDir(),
  });
  await whenSettled(job.id);
  return getRepoJob(job.id)!;
}

describe("running against a repository", () => {
  it("finishes with only what actually changed", async () => {
    const job = await runJob(editing());
    expect(job.phase).toBe("done");
    expect(Object.keys(job.changed)).toEqual(["src/total.js"]);
    expect(job.changed["src/total.js"]).toContain("length + 1");
    // README and package.json were never touched, so they are not in the
    // change at all and the base tree carries them through.
    expect(job.changed["README.md"]).toBeUndefined();
    expect(job.deleted).toEqual([]);
  }, 60_000);

  it("reports no change when the agent rewrote a file identically", async () => {
    const job = await runJob(editing(REPO["src/total.js"]));
    expect(job.phase).toBe("done");
    expect(Object.keys(job.changed)).toEqual([]);
  }, 60_000);

  it("keeps its own state out of the change", async () => {
    // The session log and the index both live under .agent inside the
    // workspace. Either one reaching a pull request would publish the run's
    // transcript into somebody's repository.
    const job = await runJob(editing());
    for (const path of Object.keys(job.changed)) {
      expect(path.startsWith(".agent")).toBe(false);
    }
    expect(existsSync(join(job.root, ".agent"))).toBe(true);
  }, 60_000);

  it("holds no GitHub credential anywhere in the workspace", async () => {
    const job = await runJob(editing());
    const config = readFileSync(join(job.root, ".git", "config"), "utf8");
    expect(config).not.toContain("url =");
    expect(config).not.toContain("github.com");
  }, 60_000);

  it("records what the agent wants the pull request to say", async () => {
    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "write_file",
            input: { path: "src/total.js", content: "export const total = () => 1;\n" },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: "2",
            name: "open_pull_request",
            input: { title: "Count each item once more", body: "Off by one." },
          },
        ],
      },
      { text: "Done." },
    ]);
    const job = await runJob(provider);
    expect(job.proposal?.title).toBe("Count each item once more");
    expect(job.proposal?.body).toContain("Off by one.");
  }, 60_000);

  it("proposes something sensible when the agent did not ask", async () => {
    const job = await runJob(editing());
    expect(job.proposal?.title).toBe("add one");
    expect(job.proposal?.body).toContain("src/total.js");
  }, 60_000);

  it("cannot open a pull request itself, whatever it calls", async () => {
    // open_pull_request is offered so the agent can name the change. Calling
    // it records a proposal and reaches nothing outward.
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "open_pull_request", input: { title: "T", body: "B" } }] },
      { text: "asked" },
    ]);
    await runJob(provider);
    const told = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(told.content).toContain("has been put to the user");
    expect(told.content).toContain("do not describe it as done");
  }, 60_000);

  it("refuses a gated tool, because there is nobody here to ask", async () => {
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "rm -rf /" } }] },
      { text: "understood" },
    ]);
    await runJob(provider);
    const told = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(told.content).toContain("did not allow");
  }, 60_000);
});

describe("what the browser is shown", () => {
  it("never includes the file contents or the path on the host", async () => {
    const job = await runJob(editing());
    const view = viewOf(job) as Record<string, unknown>;
    expect(view.changed).toBeUndefined();
    expect(view.root).toBeUndefined();
    expect(view.changedPaths).toEqual(["src/total.js"]);
    expect(JSON.stringify(view)).not.toContain(job.root);
  }, 60_000);

  it("carries the transcript, so a page can render it", async () => {
    const job = await runJob(editing());
    const view = viewOf(job);
    expect(view.events.length).toBeGreaterThan(0);
    expect(view.events.some((e) => e.kind === "step.completed")).toBe(true);
  }, 60_000);
});

describe("handing the change over", () => {
  it("gives it only for a finished run", async () => {
    const job = await runJob(editing());
    expect(changeFor(job.id)?.files["src/total.js"]).toContain("length + 1");
    expect(changeFor("not-a-job")).toBeNull();
  }, 60_000);

  it("gives nothing for a run that was cancelled", async () => {
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.ts", content: "x" } }] },
      { text: "done" },
    ]);
    const job = startRepoJob({
      repo: "owner/demo",
      ref: "main",
      goal: "g",
      files: REPO,
      provider,
      stateDir: stateDir(),
    });
    expect(cancelRepoJob(job.id)).toBe(true);
    expect(changeFor(job.id)).toBeNull();
    await whenSettled(job.id);
  }, 60_000);

  it("will not cancel a run that has already finished", async () => {
    const job = await runJob(editing());
    expect(cancelRepoJob(job.id)).toBe(false);
    expect(getRepoJob(job.id)?.phase).toBe("done");
  }, 60_000);
});

describe("when the model is unreachable", () => {
  it("ends in error with a reason, not a spinner", async () => {
    const broken = {
      name: "broken",
      model: "broken",
      generate: () => Promise.reject(new Error("connection reset")),
    } as unknown as MockProvider;
    const job = await runJob(broken);
    expect(job.phase).toBe("error");
    expect(job.error).toContain("connection reset");
    expect(changeFor(job.id)).toBeNull();
  }, 60_000);
});
