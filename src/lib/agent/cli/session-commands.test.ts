import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../providers";
import { SessionStore } from "../session-store";
import { readsOnly } from "../orchestrator";
import { SESSION_HELP, SLASH_COMMANDS, completeSlash } from "./args";
import { promptRule } from "./banner";
import { chatCommand, handleSlash, type ChatState } from "./interactive";
import { listSkills, parseSkill, skillGoal } from "./skills";
import type { CommandContext, Terminal } from "./commands";

// The commands a person types inside a conversation, the way they type them in
// claude and codex: /resume, /model, /plan and the rest.

const dirs: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "slash-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

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

function context(root: string, provider: MockProvider, term: Terminal): CommandContext {
  return { root, terminal: term, provider, maxSteps: 20, sandbox: false };
}

const fresh = (): ChatState => ({ session: null, planMode: false });

describe("the command list", () => {
  it("documents every command it answers", () => {
    for (const command of SLASH_COMMANDS) expect(SESSION_HELP).toContain(`/${command.name}`);
    for (const name of [
      "resume",
      "model",
      "plan",
      "approve",
      "skill",
      "rename",
      "new",
      "archive",
      "delete",
      "usage",
      "doctor",
      "login",
      "logout",
    ]) {
      expect(SLASH_COMMANDS.some((c) => c.name === name)).toBe(true);
    }
  });

  it("completes commands and skills on Tab", () => {
    const [hits] = completeSlash("/re", () => ["review"]);
    expect(hits).toEqual(["/rename", "/resume", "/review"]);
    expect(completeSlash("hello")[0]).toEqual([]);
    expect(completeSlash("/model anth")[0]).toEqual([]);
  });

  it("suggests the nearest command for a typo", async () => {
    const term = terminal();
    await handleSlash(context(scratch(), new MockProvider([]), term.t), "/resu", fresh());
    expect(term.errors()).toContain("/resume");
  });

  it("draws the rule above the input at the terminal's width", () => {
    const rule = promptRule("opus-5 · ~/app", { columns: 40 });
    expect(rule.trimEnd().length).toBe(40);
    expect(rule).toContain("opus-5 · ~/app");
  });
});

describe("conversations", () => {
  it("renames, archives and deletes", async () => {
    const root = scratch();
    const store = new SessionStore(root);
    const first = store.create("build a todo app", { provider: "mock", model: "m" });
    const term = terminal(["y"]);
    const ctx = context(root, new MockProvider([]), term.t);
    const state: ChatState = { session: first, planMode: false };

    await handleSlash(ctx, "/rename todo app", state);
    expect(store.load(first.id)?.title).toBe("todo app");

    expect(await handleSlash(ctx, "/archive", state)).toBe("clear");
    expect(store.list()).toHaveLength(0);
    expect(store.list({ includeArchived: true })).toHaveLength(1);

    await handleSlash(ctx, `/delete ${first.id}`, fresh());
    expect(store.load(first.id)).toBeNull();
    expect(term.text()).toContain("Deleted");
  });

  it("asks before deleting, and keeps it on anything but yes", async () => {
    const root = scratch();
    const store = new SessionStore(root);
    const record = store.create("keep me", { provider: "mock", model: "m" });
    const term = terminal([""]);
    await handleSlash(context(root, new MockProvider([]), term.t), `/delete ${record.id}`, fresh());
    expect(store.load(record.id)).not.toBeNull();
  });

  it("resumes an earlier conversation from a numbered list", async () => {
    const root = scratch();
    const provider = new MockProvider([{ text: "first" }, { text: "second" }]);
    const one = terminal(["remember the number 7", "/exit"]);
    await chatCommand(context(root, provider, one.t));

    const two = terminal(["/resume", "1", "what was the number?", "/exit"]);
    await chatCommand(context(root, provider, two.t));
    expect(two.text()).toContain("Resumed");
    const messages = provider.calls[1].messages;
    expect(messages[0].content).toContain("remember the number 7");
    expect(messages.at(-1)?.content).toBe("what was the number?");
  });

  it("reports tokens and cost on /usage", async () => {
    const root = scratch();
    const record = new SessionStore(root).create("x", { provider: "mock", model: "m" });
    record.usage = {
      inputTokens: 12_000,
      outputTokens: 800,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    const term = terminal();
    await handleSlash(context(root, new MockProvider([]), term.t), "/usage", {
      session: record,
      planMode: false,
    });
    expect(term.text()).toContain("12.0k in, 800 out");
  });
});

describe("modes", () => {
  it("toggles auto-approve for the session", async () => {
    const term = terminal();
    const ctx = context(scratch(), new MockProvider([]), term.t);
    await handleSlash(ctx, "/approve", fresh());
    expect(ctx.yes).toBe(true);
    await handleSlash(ctx, "/approve off", fresh());
    expect(ctx.yes).toBe(false);
  });

  it("names the model in use", async () => {
    const term = terminal();
    const provider = new MockProvider([]);
    await handleSlash(context(scratch(), provider, term.t), "/model", fresh());
    expect(term.text()).toContain(provider.model);
  });

  it("lets plan mode read but not write", () => {
    expect(readsOnly({ name: "read_file", input: { path: "a.ts" } })).toBe(true);
    expect(readsOnly({ name: "run_shell", input: { command: "ls -la" } })).toBe(true);
    expect(readsOnly({ name: "web_search", input: { query: "bun" } })).toBe(true);
    expect(readsOnly({ name: "write_file", input: { path: "a.ts", content: "" } })).toBe(false);
    expect(readsOnly({ name: "run_shell", input: { command: "npm install" } })).toBe(false);
    expect(readsOnly({ name: "some_mcp_tool", input: {} })).toBe(false);
  });

  it("changes nothing on disk in plan mode", async () => {
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "app.ts", content: "x" } }] },
      { text: "1. Create app.ts" },
    ]);
    const term = terminal(["/plan", "build it", "/exit"]);
    await chatCommand(context(root, provider, term.t));
    expect(existsSync(join(root, "app.ts"))).toBe(false);
    const toolResult = provider.calls[1].messages.find((m) => m.role === "tool");
    expect(String(toolResult?.content)).toContain("Plan mode is on");
  });
});

describe("skills", () => {
  function withSkill(root: string) {
    const dir = join(root, ".devstation", "skills");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "review.md"),
      "---\nname: review\ndescription: Review the code for bugs\n---\nRead every changed file and list bugs.\n",
    );
    mkdirSync(join(root, ".claude", "skills", "ship"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "skills", "ship", "SKILL.md"),
      "# Ship\nBuild, test, tag.\n",
    );
  }

  it("finds skills in both folders and reads their descriptions", () => {
    const root = scratch();
    withSkill(root);
    const skills = listSkills(root, "");
    expect(skills.map((s) => s.name).sort()).toEqual(["review", "ship"]);
    expect(skills.find((s) => s.name === "ship")?.description).toBe("Build, test, tag.");
    expect(parseSkill("no frontmatter").body).toBe("no frontmatter");
    expect(
      parseSkill("---\ndescription: >\n  Deploy to\n  Railway\n---\nbody").meta.description,
    ).toBe("Deploy to Railway");
  });

  it("runs a skill by its own name, with a task", async () => {
    const root = scratch();
    withSkill(root);
    const term = terminal();
    const outcome = await handleSlash(
      context(root, new MockProvider([]), term.t),
      "/review focus on auth",
      fresh(),
    );
    expect(typeof outcome).toBe("object");
    const goal = (outcome as { run: string }).run;
    expect(goal).toContain("list bugs");
    expect(goal).toContain("Task: focus on auth");
    expect(skillGoal(listSkills(root, "")[0], "")).toContain("Apply it");
  });
});
