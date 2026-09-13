import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../../../src/lib/agent/providers";
import type { ProviderMessage } from "../../../src/lib/agent/providers/types";
import {
  cancelWorkspace,
  createWorkspace,
  getWorkspace,
  parseWorkspaceSource,
  previewDist,
  previewPlan,
  sendWorkspaceMessage,
  startWorkspacePreview,
  trimHistory,
  whenWorkspaceIdle,
  workspaceFiles,
  workspaceMessages,
  workspaceView,
} from "./workspace-agent";

// The browser Coding Agent's workspace, offline: the model is scripted, the
// workspace, its files and the conversation are real.

const dirs: string[] = [];
function stateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ws-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const offline = { sandbox: false, preview: false } as const;

async function blank() {
  const created = await createWorkspace({
    owner: "0xabc",
    source: { kind: "blank" },
    stateDir: stateDir(),
  });
  if (!created.ok) throw new Error(created.message);
  return created.session;
}

async function say(id: string, prompt: string, provider: MockProvider) {
  const sent = sendWorkspaceMessage(id, prompt, { ...offline, provider });
  if (!sent.ok) throw new Error(sent.message);
  await whenWorkspaceIdle(id);
  return getWorkspace(id)!;
}

describe("a conversation over one workspace", () => {
  it("starts from nothing, with no GitHub involved", async () => {
    const session = await blank();
    expect(session.phase).toBe("idle");
    expect(session.fileCount).toBe(0);
    expect(session.source).toEqual({ kind: "blank" });
  });

  it("builds files and reports the turn", async () => {
    const session = await blank();
    const after = await say(
      session.id,
      "make a hello page",
      new MockProvider([
        {
          toolCalls: [
            {
              id: "1",
              name: "write_file",
              input: { path: "index.html", content: "<h1>hi</h1>\n" },
            },
          ],
        },
        { text: "Made index.html." },
      ]),
    );
    expect(after.phase).toBe("idle");
    expect(after.turns).toBe(1);
    expect(after.revision).toBe(1);
    expect(after.reply).toContain("Made index.html.");
    expect(workspaceFiles(session.id)).toEqual({ "index.html": "<h1>hi</h1>\n" });
  });

  it("carries the conversation into the next message", async () => {
    const session = await blank();
    await say(session.id, "remember the word teal", new MockProvider([{ text: "Noted." }]));
    const provider = new MockProvider([{ text: "You said teal." }]);
    const after = await say(session.id, "what word?", provider);
    expect(after.turns).toBe(2);
    const history = workspaceMessages(session.id);
    const userTexts = history.filter((m) => m.role === "user").map((m) => m.content);
    expect(userTexts).toContain("remember the word teal");
    expect(userTexts).toContain("what word?");
  });

  it("refuses a second message while one is running", async () => {
    const session = await blank();
    const first = sendWorkspaceMessage(session.id, "slow", {
      ...offline,
      provider: new MockProvider([{ text: "done" }]),
    });
    expect(first.ok).toBe(true);
    const second = sendWorkspaceMessage(session.id, "again", {
      ...offline,
      provider: new MockProvider([{ text: "done" }]),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
    await whenWorkspaceIdle(session.id);
  });

  it("says a missing workspace is gone, so the page can recreate it", () => {
    const sent = sendWorkspaceMessage("ws-nope", "hi", offline);
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.status).toBe(404);
  });

  it("will not cancel a workspace that is not running", async () => {
    const session = await blank();
    expect(cancelWorkspace(session.id)).toBe(false);
  });

  it("never shows the browser the host path or the owner", async () => {
    const session = await blank();
    const view = workspaceView(session) as Record<string, unknown>;
    expect(view.root).toBeUndefined();
    expect(view.owner).toBeUndefined();
    expect(view.id).toBe(session.id);
  });
});

describe("where a workspace starts", () => {
  it("takes uploaded files, and keeps the repository they belong to", async () => {
    const parsed = parseWorkspaceSource({
      kind: "files",
      repo: "owner/demo",
      ref: "main",
      files: { "src/a.ts": "export const a = 1;\n" },
    });
    if ("error" in parsed) throw new Error(parsed.error);
    const created = await createWorkspace({
      owner: "0xabc",
      source: parsed.source,
      files: parsed.files,
      stateDir: stateDir(),
    });
    if (!created.ok) throw new Error(created.message);
    expect(created.session.source).toEqual({ kind: "files", repo: "owner/demo", ref: "main" });
    expect(workspaceFiles(created.session.id)).toEqual({ "src/a.ts": "export const a = 1;\n" });
  });

  it("imports a public repository without a token", async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string) => {
      calls.push(url);
      if (url.startsWith("https://api.github.com/")) {
        return new Response(JSON.stringify({ default_branch: "trunk", full_name: "Owner/Demo" }));
      }
      return new Response(null, { status: 404 });
    }) as unknown as typeof fetch;
    const created = await createWorkspace({
      owner: "0xabc",
      source: { kind: "github", repo: "https://github.com/owner/demo" },
      stateDir: stateDir(),
      fetchImpl: fakeFetch,
    });
    // The download itself is refused by the fake, which is the point: it was
    // asked for the default branch, anonymously.
    expect(created.ok).toBe(false);
    expect(calls[1]).toBe("https://codeload.github.com/owner/demo/tar.gz/trunk");
  });

  it("rejects what is not a repository or not a source", () => {
    expect("error" in parseWorkspaceSource({ kind: "github", repo: "nope" })).toBe(true);
    expect("error" in parseWorkspaceSource({ kind: "shell" })).toBe(true);
    expect("error" in parseWorkspaceSource(null)).toBe(true);
  });
});

describe("the preview", () => {
  it("serves a static page as it is", async () => {
    const session = await blank();
    await say(
      session.id,
      "page",
      new MockProvider([
        {
          toolCalls: [
            { id: "1", name: "write_file", input: { path: "index.html", content: "<p>x</p>" } },
          ],
        },
        { text: "ok" },
      ]),
    );
    const started = startWorkspacePreview(session.id);
    expect(started.ok).toBe(true);
    expect(getWorkspace(session.id)!.preview.phase).toBe("ready");
    expect(previewDist(session.id)).toEqual({ "index.html": "<p>x</p>" });
  });

  it("builds a project with a build script, and reports a failed build", async () => {
    const session = await blank();
    await say(
      session.id,
      "vite",
      new MockProvider([
        {
          toolCalls: [
            {
              id: "1",
              name: "write_file",
              input: { path: "package.json", content: '{"scripts":{"build":"vite build"}}' },
            },
          ],
        },
        { text: "ok" },
      ]),
    );
    let resolveBuild: (v: { ok: boolean; dist: null; message: string }) => void = () => {};
    const build = () =>
      new Promise<{ ok: boolean; dist: null; message: string }>((r) => (resolveBuild = r));
    startWorkspacePreview(session.id, build);
    expect(getWorkspace(session.id)!.preview.phase).toBe("building");
    resolveBuild({ ok: false, dist: null, message: "The build step failed." });
    await new Promise((r) => setTimeout(r, 0));
    expect(getWorkspace(session.id)!.preview).toMatchObject({
      phase: "error",
      message: "The build step failed.",
    });
  });

  it("finds the front end in the root or a conventional folder", () => {
    expect(previewPlan({ "index.html": "" })).toEqual({ kind: "static", dir: "" });
    expect(previewPlan({ "web/package.json": '{"scripts":{"build":"vite build"}}' })).toEqual({
      kind: "build",
      dir: "web/",
      outDir: "dist",
    });
    expect(
      previewPlan({ "package.json": '{"scripts":{"build":"react-scripts build"}}' }),
    ).toMatchObject({ outDir: "build" });
    expect(previewPlan({ "contracts/Token.sol": "" }).kind).toBe("none");
  });
});

describe("carrying the conversation", () => {
  it("drops the oldest exchanges first, and never starts on a tool result", () => {
    const messages: ProviderMessage[] = [
      { role: "user", content: "a".repeat(50) },
      { role: "assistant", content: "b".repeat(50) },
      { role: "tool", toolCallId: "1", content: "c".repeat(50) },
      { role: "user", content: "d".repeat(10) },
      { role: "assistant", content: "e".repeat(10) },
    ];
    const kept = trimHistory(messages, 80);
    expect(kept[0].role).toBe("user");
    expect(kept.map((m) => m.content[0])).toEqual(["d", "e"]);
  });
});
