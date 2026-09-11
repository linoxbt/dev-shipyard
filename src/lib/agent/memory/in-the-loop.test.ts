import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../providers";
import { approxTokens } from "./chunk";
import { Orchestrator } from "../orchestrator";
import { Workspace } from "../workspace";
import { materialise } from "../repo-session";
import { readMemory } from "./project-memory";
import { indexWorkspace, openStore } from "./workspace-index";
import type { MemoryStore } from "./store";

// Phase F's two claims, end to end: that it can answer about a project it was
// never handed, and that it remembers a decision across two sessions.

const dirs: string[] = [];
const stores: MemoryStore[] = [];
function scratch(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "loop-mem-"));
  dirs.push(root);
  materialise(files, root);
  return root;
}
afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A project big enough that handing the whole thing to a model is not an
 *  option, with one fact buried in it. */
function bigProject(): Record<string, string> {
  const files: Record<string, string> = {};
  for (let i = 0; i < 120; i++) {
    files[`src/module${i}/handler.ts`] =
      `export function handle${i}(request) {\n` +
      `  // Ordinary handler number ${i}, nothing special about it.\n` +
      `  return { ok: true, module: ${i} };\n}\n`;
  }
  files["src/billing/proration.ts"] =
    `/** Works out the refund when a plan is downgraded mid-cycle. */
export function prorateRefund(plan, daysLeft) {
  // Rounded down to the nearest cent, deliberately: rounding up cost us money.
  return Math.floor(plan.monthlyCents * (daysLeft / 30));
}
`;
  return files;
}

async function indexed(root: string): Promise<MemoryStore> {
  const store = openStore(root);
  stores.push(store);
  await indexWorkspace(root, { store });
  return store;
}

describe("answering about a project it was never fed", () => {
  it("puts the right file in front of the model before the first turn", async () => {
    const root = scratch(bigProject());
    const memory = await indexed(root);
    const provider = new MockProvider([{ text: "It rounds down to the nearest cent." }]);

    await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      memory,
    }).run("how is a refund calculated when someone downgrades part way through a month");

    const firstMessage = String(provider.calls[0].messages[0].content);
    expect(firstMessage).toContain("src/billing/proration.ts");
    expect(firstMessage).toContain("Rounded down to the nearest cent");
    // And it did not drag in a hundred unrelated handlers to do it.
    expect(firstMessage).not.toContain("handle77");
  }, 60_000);

  it("keeps the goal itself intact", async () => {
    const root = scratch(bigProject());
    const memory = await indexed(root);
    const provider = new MockProvider([{ text: "ok" }]);
    const goal = "how is a refund calculated on a downgrade";

    await new Orchestrator({ provider, workspace: new Workspace(root), memory }).run(goal);
    expect(String(provider.calls[0].messages[0].content)).toContain(goal);
  }, 60_000);

  it("holds the retrieved context to its budget", async () => {
    const root = scratch(bigProject());
    const memory = await indexed(root);
    const provider = new MockProvider([{ text: "ok" }]);

    await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      memory,
      retrievalTokens: 400,
    }).run("refund downgrade proration handler module");

    // The budget covers what is actually sent, headers and preamble included,
    // not just the chunk text inside them.
    const firstMessage = String(provider.calls[0].messages[0].content);
    const context = firstMessage.slice(0, firstMessage.lastIndexOf("\n\n"));
    expect(approxTokens(context)).toBeLessThanOrEqual(400);
  }, 60_000);

  it("works exactly as before when there is no index", async () => {
    const root = scratch(bigProject());
    const provider = new MockProvider([{ text: "ok" }]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("a question");
    expect(String(provider.calls[0].messages[0].content)).toBe("a question");
  }, 60_000);

  it("retrieves once, not on every turn", async () => {
    // Re-retrieving each turn spends the context budget on the same excerpts
    // over and over, crowding out what the tools actually returned.
    const root = scratch(bigProject());
    const memory = await indexed(root);
    const provider = new MockProvider([
      {
        toolCalls: [{ id: "1", name: "read_file", input: { path: "src/billing/proration.ts" } }],
      },
      { text: "done" },
    ]);

    await new Orchestrator({ provider, workspace: new Workspace(root), memory }).run("refund");

    const contexts = provider.calls[1].messages.filter((m) =>
      String(m.content).includes("Relevant parts of this project"),
    );
    expect(contexts).toHaveLength(1);
  }, 60_000);

  it("can search again mid-task with recall", async () => {
    const root = scratch(bigProject());
    const memory = await indexed(root);
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "recall", input: { query: "prorate refund downgrade" } }] },
      { text: "found it" },
    ]);

    await new Orchestrator({ provider, workspace: new Workspace(root), memory }).run("look");

    const result = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(result.content).toContain("src/billing/proration.ts");
  }, 60_000);

  it("says so, rather than failing, when recall has no index behind it", async () => {
    const root = scratch({ "a.ts": "export const a = 1;\n" });
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "recall", input: { query: "anything" } }] },
      { text: "ok" },
    ]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("look");
    const result = provider.calls[1].messages.find((m) => m.role === "tool") as {
      content: string;
      isError?: boolean;
    };
    expect(result.content).toContain("has not been indexed");
    expect(result.content).toContain("search_files");
  }, 60_000);
});

describe("remembering across sessions", () => {
  it("carries a decision from one run into the next", async () => {
    const root = scratch({ "a.ts": "export const a = 1;\n" });

    // First session: it is told something and writes it down.
    const first = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "remember",
            input: {
              note: "Deploys go out from main only. Everything else goes to app-builder.",
              tag: "process",
            },
          },
        ],
      },
      { text: "Noted." },
    ]);
    await new Orchestrator({ provider: first, workspace: new Workspace(root) }).run(
      "remember that deploys go out from main only",
    );
    expect(readMemory(root)[0].note).toContain("app-builder");

    // Second session: a new orchestrator, a new provider, nothing carried in
    // memory except the file on disk.
    const second = new MockProvider([{ text: "Understood." }]);
    await new Orchestrator({ provider: second, workspace: new Workspace(root) }).run(
      "where do deploys come from",
    );

    const system = String(second.calls[0].system);
    expect(system).toContain("app-builder");
    // And it is framed as a note, not as an order from the user.
    expect(system).toContain("not instructions from the user");
  }, 60_000);

  it("does not duplicate a note it has already made", async () => {
    const root = scratch({ "a.ts": "export const a = 1;\n" });
    const note = "The runner is self-hosted on port 8792.";
    for (const _ of [1, 2]) {
      const provider = new MockProvider([
        { toolCalls: [{ id: "1", name: "remember", input: { note } }] },
        { text: "ok" },
      ]);
      await new Orchestrator({ provider, workspace: new Workspace(root) }).run("note it");
    }
    expect(readMemory(root)).toHaveLength(1);
  }, 60_000);

  it("never asks permission to write a note about the project", async () => {
    // Interrupting someone to approve "I wrote down that deploys come from
    // main" would make the feature unusable.
    const root = scratch({ "a.ts": "export const a = 1;\n" });
    let asked = 0;
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "remember", input: { note: "a fact" } }] },
      { text: "ok" },
    ]);
    await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      requestApproval: async () => {
        asked++;
        return true;
      },
    }).run("note it");
    expect(asked).toBe(0);
    expect(readMemory(root)).toHaveLength(1);
  }, 60_000);
});
