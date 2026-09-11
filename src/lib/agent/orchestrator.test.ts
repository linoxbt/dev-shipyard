import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "./providers";
import { Orchestrator, costOf, partialTurn, type AgentEvent } from "./orchestrator";
import { Workspace } from "./workspace";
import { EMPTY_USAGE } from "./providers";

// The whole loop, offline. This is what the mock provider is for: every part
// of the agent except the model's judgement runs deterministically here.

const dirs: string[] = [];
function ws(files: Record<string, string> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), "orch-"));
  dirs.push(root);
  const w = new Workspace(root);
  for (const [p, c] of Object.entries(files)) w.write(p, c);
  return w;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GREET = `function greet(name) {
  return "Hello, " + name + "!";
}
`;

describe("the agent loop", () => {
  it("reads a file, patches it, and reports what it did", async () => {
    const workspace = ws({ "greet.js": GREET });
    const provider = new MockProvider([
      {
        text: "Let me look.",
        toolCalls: [{ id: "1", name: "read_file", input: { path: "greet.js" } }],
      },
      {
        text: "Adding the guard.",
        toolCalls: [
          {
            id: "2",
            name: "edit_file",
            input: {
              path: "greet.js",
              patch: `@@ -1,2 +1,3 @@\n function greet(name) {\n+  if (!name) throw new Error("name is required");\n   return "Hello, " + name + "!";`,
            },
          },
        ],
      },
      { text: "Added a guard for an empty name." },
    ]);

    const events: AgentEvent[] = [];
    const result = await new Orchestrator({
      provider,
      workspace,
      onEvent: (e) => events.push(e),
    }).run("make greet throw on empty input");

    expect(result.ok).toBe(true);
    expect(result.steps).toBe(2);
    expect(result.filesChanged).toEqual(["greet.js"]);
    expect(readFileSync(join(workspace.root, "greet.js"), "utf8")).toContain("name is required");
    expect(result.summary).toContain("guard");
    expect(events.map((e) => e.kind)).toContain("task.completed");
  });

  it("feeds a tool's real output back, rather than assuming it worked", async () => {
    const workspace = ws({ "greet.js": GREET });
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "read_file", input: { path: "greet.js" } }] },
      { text: "done" },
    ]);
    await new Orchestrator({ provider, workspace }).run("look at greet.js");

    // The second call must contain the file's actual contents as a tool result.
    const second = provider.calls[1];
    const toolMessage = second.messages.find((m) => m.role === "tool");
    expect(toolMessage).toBeDefined();
    expect((toolMessage as { content: string }).content).toContain("Hello, ");
  });

  it("hands a failure back as an error result instead of stopping", async () => {
    const workspace = ws();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "read_file", input: { path: "missing.js" } }] },
      { text: "That file does not exist." },
    ]);
    const result = await new Orchestrator({ provider, workspace }).run("read missing.js");

    const toolMessage = provider.calls[1].messages.find((m) => m.role === "tool") as {
      content: string;
      isError?: boolean;
    };
    expect(toolMessage.isError).toBe(true);
    expect(toolMessage.content).toContain("no file at");
    expect(result.ok).toBe(true); // the run finished; the tool call is what failed
  });
});

describe("the gate, inside the loop", () => {
  it("asks before a gated tool and does not run it when refused", async () => {
    const workspace = ws({ "old.js": "// stale\n" });
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "rm -rf /" } }] },
      { text: "Understood." },
    ]);
    const asked: string[] = [];
    const result = await new Orchestrator({
      provider,
      workspace,
      requestApproval: async (r) => {
        asked.push(r.operation);
        return false;
      },
    }).run("clean up");

    expect(asked).toContain("shell.exec");
    const toolMessage = provider.calls[1].messages.find((m) => m.role === "tool") as {
      content: string;
    };
    expect(toolMessage.content).toContain("did not allow");
    expect(result.ok).toBe(true);
  });

  it("runs the tool once approved", async () => {
    const workspace = ws();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "echo approved" } }] },
      { text: "done" },
    ]);
    await new Orchestrator({ provider, workspace, requestApproval: async () => true }).run(
      "say hi",
    );
    const toolMessage = provider.calls[1].messages.find((m) => m.role === "tool") as {
      content: string;
    };
    expect(toolMessage.content).toContain("approved");
  });

  it("refuses everything gated when the host wired up no approver", async () => {
    // Failing closed. A host that forgot to pass requestApproval must not
    // silently get full autonomy.
    const workspace = ws();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "rm -rf /" } }] },
      { text: "ok" },
    ]);
    await new Orchestrator({ provider, workspace }).run("do it");
    const toolMessage = provider.calls[1].messages.find((m) => m.role === "tool") as {
      content: string;
    };
    expect(toolMessage.content).toContain("did not allow");
  });

  it("lets a read-only command through without asking", async () => {
    const workspace = ws();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "run_shell", input: { command: "echo hello" } }] },
      { text: "done" },
    ]);
    let asked = 0;
    await new Orchestrator({
      provider,
      workspace,
      requestApproval: async () => {
        asked++;
        return true;
      },
    }).run("echo");
    expect(asked).toBe(0);
  });
});

describe("budgets", () => {
  it("stops at the step limit instead of looping forever", async () => {
    const workspace = ws({ "a.js": "1\n" });
    // A model that never stops asking for the same read.
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "read_file", input: { path: "a.js" } }] },
    ]);
    const result = await new Orchestrator({ provider, workspace, maxSteps: 5 }).run("loop");
    expect(result.ok).toBe(false);
    expect(result.stoppedBecause).toContain("steps");
    expect(result.steps).toBeLessThanOrEqual(6);
  });

  it("stops when the run reaches its money budget", async () => {
    const workspace = ws({ "a.js": "1\n" });
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "read_file", input: { path: "a.js" } }] },
    ]);
    // The mock reports usage per turn, so a tiny cap is reached quickly.
    const result = await new Orchestrator({
      provider,
      workspace,
      maxSteps: 1000,
      maxCostUsd: 0.000_3,
    }).run("loop");
    expect(result.ok).toBe(false);
    expect(result.stoppedBecause).toContain("budget");
  });

  it("prices a turn from tokens", () => {
    const cost = costOf({ ...EMPTY_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect(cost).toBeGreaterThan(0);
  });
});

describe("checkpoints during a run", () => {
  it("commits after a turn that changed a file, in a repo", async () => {
    const workspace = ws({ "a.js": "1\n" });
    writeFileSync(join(workspace.root, ".gitignore"), "");
    const { runShell } = await import("./shell");
    await runShell(
      "git init -q && git config user.email a@b.c && git config user.name T && git add -A && git commit -qm init",
      {
        cwd: workspace.root,
      },
    );

    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "b.js", content: "2\n" } }] },
      { text: "added b.js" },
    ]);
    const events: AgentEvent[] = [];
    await new Orchestrator({ provider, workspace, onEvent: (e) => events.push(e) }).run("add b.js");

    expect(events.some((e) => e.kind === "checkpoint")).toBe(true);
  }, 30_000);

  it("does not try to check point outside a repository", async () => {
    const workspace = ws({ "a.js": "1\n" });
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "write_file", input: { path: "b.js", content: "2\n" } }] },
      { text: "done" },
    ]);
    const events: AgentEvent[] = [];
    await new Orchestrator({ provider, workspace, onEvent: (e) => events.push(e) }).run("add b.js");
    expect(events.some((e) => e.kind === "checkpoint")).toBe(false);
  });
});

describe("a turn that only half happened", () => {
  it("says so, in the transcript and to the model", async () => {
    // A turn asking for three tools is one unit of work to the model and three
    // to the workspace. When the third fails after the first two have written,
    // nothing rolls back, and without this the run carries on as though the
    // turn either fully happened or fully did not.
    const workspace = ws({ "a.js": "1\n" });
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "1", name: "write_file", input: { path: "b.js", content: "2\n" } },
          { id: "2", name: "write_file", input: { path: "c.js", content: "3\n" } },
          { id: "3", name: "read_file", input: { path: "missing.js" } },
        ],
      },
      { text: "I see." },
    ]);

    const events: AgentEvent[] = [];
    const result = await new Orchestrator({
      provider,
      workspace,
      onEvent: (e) => events.push(e),
    }).run("write two files and read a third");

    const partial = events.find((e) => e.kind === "turn.partial");
    expect(partial).toBeDefined();
    expect(partial?.message).toContain("2 of 3");
    expect(partial?.message).toContain("half-applied");

    // And the model was told, not just the log.
    const told = provider.calls[1].messages.find(
      (m) => m.role === "user" && String(m.content).includes("half-applied"),
    );
    expect(told).toBeDefined();
    // The files that did land are still there: nothing is rolled back.
    expect(readFileSync(join(workspace.root, "b.js"), "utf8")).toBe("2\n");
    expect(result.ok).toBe(true);
  });

  it("stays quiet when every call in the turn worked", async () => {
    const workspace = ws({ "a.js": "1\n" });
    const provider = new MockProvider([
      {
        toolCalls: [
          { id: "1", name: "write_file", input: { path: "b.js", content: "2\n" } },
          { id: "2", name: "write_file", input: { path: "c.js", content: "3\n" } },
        ],
      },
      { text: "done" },
    ]);
    const events: AgentEvent[] = [];
    await new Orchestrator({ provider, workspace, onEvent: (e) => events.push(e) }).run(
      "two files",
    );
    expect(events.some((e) => e.kind === "turn.partial")).toBe(false);
  });

  it("stays quiet when every call failed, which needs no special warning", () => {
    expect(partialTurn({ applied: [], failed: ["a", "b"] }, 2)).toBeNull();
    expect(partialTurn({ applied: ["a", "b"], failed: [] }, 2)).toBeNull();
  });

  it("says nothing about a turn with one tool in it", () => {
    // One call that failed is just a failed call, and it already said so.
    expect(partialTurn({ applied: [], failed: ["read_file"] }, 1)).toBeNull();
    expect(partialTurn({ applied: ["write_file"], failed: [] }, 1)).toBeNull();
  });

  it("names which tools landed and which did not", () => {
    const message = partialTurn({ applied: ["write_file"], failed: ["run_tests"] }, 2);
    expect(message).toContain("write_file");
    expect(message).toContain("run_tests");
  });
});
