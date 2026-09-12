import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "./providers";
import { Orchestrator } from "./orchestrator";
import { Workspace } from "./workspace";
import { allowedEnv, hostExecutor, refusedForSecret } from "./executor";
import { readFileSync } from "node:fs";
import { runShell } from "./shell";

// Three ways the agent could get past its own permission gate, each one
// reproduced here as the attack before it was fixed. They are written as
// exploits rather than as unit tests because that is what they are: if any of
// these starts passing the injected payload again, the gate is open.

const dirs: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "exec-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Run one tool call through the real orchestrator with an approver that
 *  refuses everything, and hand back what the model was told. */
async function throughAgent(root: string, tool: string, input: Record<string, unknown>) {
  const provider = new MockProvider([
    { toolCalls: [{ id: "1", name: tool, input }] },
    { text: "done" },
  ]);
  let asked = 0;
  await new Orchestrator({
    provider,
    workspace: new Workspace(root),
    requestApproval: async () => {
      asked++;
      return false;
    },
  }).run("go");
  const result = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
  return { output: result.content, asked };
}

describe("git arguments reaching the shell", () => {
  const marker = join(tmpdir(), "devstation-injection-proof");

  afterEach(() => {
    try {
      unlinkSync(marker);
    } catch {
      /* never created, which is the point */
    }
  });

  it("cannot run a command smuggled through git diff", async () => {
    // The real one. `agentDiff` spliced these straight into a shell string,
    // and `diff` classifies as project.inspect, so nothing asked. Verified
    // exploitable on this codebase before the fix.
    const root = scratch();
    await runShell(
      "git init -q && git config user.email a@b.c && git config user.name T && " +
        "echo x > a.txt && git add -A && git commit -qm init",
      { cwd: root },
    );

    const { asked } = await throughAgent(root, "git", {
      op: "diff",
      args: [`; touch ${marker}`],
    });

    expect(existsSync(marker)).toBe(false);
    expect(asked).toBe(0); // it never even needed to ask, which is why it mattered
  }, 30_000);

  it("passes an ordinary argument through untouched", async () => {
    const root = scratch();
    await runShell(
      "git init -q && git config user.email a@b.c && git config user.name T && " +
        "printf 'one\\n' > a.txt && git add -A && git commit -qm init",
      { cwd: root },
    );
    writeFileSync(join(root, "a.txt"), "two\n");

    const { output } = await throughAgent(root, "git", { op: "diff", args: ["--", "a.txt"] });
    expect(output).toContain("-one");
    expect(output).toContain("+two");
  }, 30_000);
});

describe("what a command can see", () => {
  it("does not hand the parent's secrets to the child", async () => {
    // The severity is not that the model reads the key: secrets.ts redacts
    // key-shaped values on the way back. It is that a command which HOLDS a
    // credential can spend it without ever printing it.
    process.env.DEVSTATION_TEST_SENTINEL = "plain-value-not-key-shaped";
    try {
      const root = scratch();
      const { output } = await throughAgent(root, "run_shell", {
        command: "printenv DEVSTATION_TEST_SENTINEL",
      });
      expect(output).not.toContain("plain-value-not-key-shaped");
    } finally {
      delete process.env.DEVSTATION_TEST_SENTINEL;
    }
  }, 30_000);

  it("still passes what a build actually needs", () => {
    const env = allowedEnv({ PATH: "/usr/bin", HOME: "/home/me", SECRET_TOKEN: "nope" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/me");
    expect(env.SECRET_TOKEN).toBeUndefined();
  });

  it("lets a caller pass something through deliberately", () => {
    const env = allowedEnv({ PATH: "/usr/bin" }, { GITHUB_TOKEN: "deliberate" });
    expect(env.GITHUB_TOKEN).toBe("deliberate");
  });
});

describe("the secrets guard, through the shell", () => {
  it("refuses to cat a file read_file would refuse", async () => {
    // Workspace refuses .env through read_file, with a reason. `cat` is on the
    // read-only allow-list, so the shell walked straight past that.
    const root = scratch();
    writeFileSync(join(root, ".env"), "PLAIN_NOTE=just-some-text-abc\n");

    const { output } = await throughAgent(root, "run_shell", { command: "cat .env" });
    expect(output).not.toContain("just-some-text-abc");
    expect(output).toContain("credentials file");
  }, 30_000);

  it("recognises the shapes the workspace already knows", () => {
    for (const command of [
      "cat .env",
      "cat ./.env.local",
      "cp secrets/id_rsa /tmp",
      "head server.key",
      "cat ~/.npmrc",
    ]) {
      expect(refusedForSecret(command)).not.toBeNull();
    }
  });

  it("leaves ordinary commands alone", () => {
    for (const command of ["ls -la", "npm test", "cat package.json", "grep -rn environment src/"]) {
      expect(refusedForSecret(command)).toBeNull();
    }
  });

  it("is consistent with read_file, including where read_file is over-broad", () => {
    // `.env.example` is usually a committed template with no secrets in it,
    // and the workspace's own SECRET_PATTERNS refuse it. Matching that here is
    // the point: two guards over the same files that disagree would be worse
    // than one that is occasionally too careful.
    expect(refusedForSecret("cat .env.example")).not.toBeNull();
  });

  it("says plainly that it is not a boundary", () => {
    // Documented as a test so nobody mistakes this for one. It reads the words
    // in the command, so a path the shell assembles at run time goes straight
    // past it. The sandbox is the boundary; this stops the accident and the
    // first thing anyone tries.
    expect(refusedForSecret("F=.env; cat $F")).toBeNull();
  });
});

describe("the host executor", () => {
  it("returns the same shape a command does", async () => {
    const root = scratch();
    const result = await hostExecutor().run("echo hello", { cwd: root });
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe("hello");
    expect(result.timedOut).toBe(false);
  });

  it("reports a failing command as failed rather than throwing", async () => {
    const result = await hostExecutor().run("exit 3", { cwd: scratch() });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(3);
  });
});

describe("where the orchestrator may spawn a process", () => {
  it("has no way to run a command except through the executor", () => {
    // The import being absent is the enforcement. A fifth call site cannot
    // appear without someone re-adding an import this test forbids, which is
    // the same reasoning workspace.ts uses for its own boundary.
    const source = readFileSync(new URL("./orchestrator.ts", import.meta.url), "utf8");
    const runtimeImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gm)]
      .map((m) => m[1])
      .filter((spec) => spec === "./shell");
    expect(runtimeImports).toEqual([]);
    expect(source).not.toContain("runShell(");
  });
});
