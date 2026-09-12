import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "./providers";
import { Orchestrator, type ApprovalRequest } from "./orchestrator";
import { Workspace } from "./workspace";
import { cloneDirName, cloneUrlProblem } from "./git-ops";
import { preflight } from "./tools";
import { runShell } from "./shell";
import type { ExecOptions, Executor } from "./executor";

// Cloning a repository into the workspace.
//
// The op exists for risk classification rather than capability: the model
// could already run `git clone` through run_shell. What it could not do is
// have the difference between cloning into empty space and cloning on top of
// someone's files show up in what they are asked to approve.

const dirs: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "clone-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A real repository on this machine, to clone from without a network. */
async function originRepo(): Promise<string> {
  const root = scratch();
  writeFileSync(join(root, "README.md"), "# origin\n");
  await runShell(
    "git init -q && git config user.email a@b.c && git config user.name T && " +
      "git add -A && git commit -qm init",
    { cwd: root },
  );
  return root;
}

function classify(args: Record<string, unknown>, populated?: (path: string) => boolean) {
  return preflight(
    { id: "1", name: "git", args },
    { taskId: "t", userId: "u", projectId: "p", environment: "development", populated },
  );
}

describe("what a clone URL is allowed to be", () => {
  it("accepts the forms git itself accepts", () => {
    for (const url of [
      "https://github.com/owner/repo.git",
      "http://gitlab.internal/team/thing",
      "ssh://git@bitbucket.org/owner/repo.git",
      "git://example.com/repo.git",
      "git@github.com:owner/repo.git",
    ]) {
      expect(cloneUrlProblem(url)).toBeNull();
    }
  });

  it("refuses the transports that run a command", () => {
    // `ext::` is not an exotic edge case: it is git's documented way to run an
    // arbitrary program as a transport. A model-supplied string reaching it is
    // remote code execution on whichever machine the clone happens on.
    expect(cloneUrlProblem("ext::sh -c 'touch /tmp/pwned'")).not.toBeNull();
    expect(cloneUrlProblem("--upload-pack=/bin/sh")).not.toBeNull();
    expect(cloneUrlProblem("-u/bin/sh")).not.toBeNull();
    expect(cloneUrlProblem("file:///etc")).not.toBeNull();
    expect(cloneUrlProblem("/etc/passwd")).not.toBeNull();
    expect(cloneUrlProblem("")).not.toBeNull();
  });

  it("picks the directory name git would pick", () => {
    expect(cloneDirName("https://github.com/owner/repo.git")).toBe("repo");
    expect(cloneDirName("git@github.com:owner/thing")).toBe("thing");
    expect(cloneDirName("https://example.com/a/b/c.git/")).toBe("c");
  });
});

describe("how a clone is classified", () => {
  it("is an ordinary write into empty space", () => {
    const gate = classify(
      { op: "clone", url: "https://github.com/owner/repo.git" },
      () => false, // nothing there
    );
    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.rejection.reason).toBe("needs_authorization");
    if (gate.rejection.reason !== "needs_authorization") return;
    expect(gate.rejection.action.operation).toBe("vcs.clone");
    expect(gate.rejection.verdict.riskLevel).toBe("medium");
  });

  it("escalates when the target already has files in it", () => {
    // The whole point of the op. Cloning on top of work in progress can merge
    // a stranger's repository into it, and the sentence the user is shown
    // should say so.
    const gate = classify(
      { op: "clone", url: "https://github.com/owner/repo.git" },
      () => true, // already populated
    );
    expect(gate.ok).toBe(false);
    if (gate.ok || gate.rejection.reason !== "needs_authorization") return;
    expect(gate.rejection.action.operation).toBe("vcs.clone.into_existing");
    expect(gate.rejection.verdict.riskLevel).toBe("high");
    expect(gate.rejection.message).toContain("already has files in it");
  });

  it("treats not knowing as the higher risk", () => {
    // A caller with no probe cannot see the filesystem. Assuming empty would
    // be the convenient default and the wrong one.
    const gate = classify({ op: "clone", url: "https://github.com/owner/repo.git" });
    if (gate.ok || gate.rejection.reason !== "needs_authorization")
      throw new Error("expected gate");
    expect(gate.rejection.action.operation).toBe("vcs.clone.into_existing");
  });

  it("shows the URL to whoever is approving it", () => {
    const gate = classify({ op: "clone", url: "https://github.com/owner/repo.git" }, () => false);
    if (gate.ok || gate.rejection.reason !== "needs_authorization")
      throw new Error("expected gate");
    expect(gate.rejection.action.resources).toContain("https://github.com/owner/repo.git");
  });

  it("leaves every other op classified as it was", () => {
    const status = classify({ op: "status" }, () => true);
    expect(status.ok).toBe(true);
  });
});

describe("cloning, for real", () => {
  it("runs the command git would run, with a network, inside the workspace", async () => {
    // A stub executor rather than a real clone: the allow-list refuses local
    // paths, so an offline end-to-end clone would need a git daemon, and what
    // is worth asserting is the command and the options it is given.
    const root = scratch();
    const seen: { command: string; opts: ExecOptions }[] = [];
    const executor: Executor = {
      kind: "host",
      describe: "stub",
      async run(command, opts) {
        seen.push({ command, opts });
        return {
          ok: true,
          code: 0,
          stdout: "Cloning into 'brought-in'...",
          stderr: "",
          timedOut: false,
        };
      },
      async dispose() {},
    };

    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "git",
            input: {
              op: "clone",
              url: "https://github.com/owner/repo.git",
              target_dir: "brought-in",
            },
          },
        ],
      },
      { text: "Cloned it." },
    ]);
    await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      executor,
      requestApproval: async () => true,
    }).run("clone it");

    expect(seen).toHaveLength(1);
    // `--` ends the options, and both arguments are quoted: a URL that
    // survived the allow-list still never reaches a shell unquoted.
    expect(seen[0].command).toBe("git clone -- 'https://github.com/owner/repo.git' 'brought-in'");
    // It goes through the executor, so in a sandboxed run it happens in the
    // container rather than beside it on the host.
    expect(seen[0].opts.cwd).toBe(new Workspace(root).root);
    // The sealed shell has no network; a clone is one of the few things that
    // genuinely needs one.
    expect(seen[0].opts.network).toBe(true);
  }, 60_000);

  it("refuses a local path even though git would accept it", async () => {
    // Deliberate. Allowing file:// or a bare path would let the model reach
    // any repository on the host, which is the boundary the workspace exists
    // to hold.
    const origin = await originRepo();
    const root = scratch();
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "git", input: { op: "clone", url: origin } }] },
      { text: "It refused." },
    ]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("clone it");

    const told = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(told.content).toContain("does not look like a repository URL");
    // Rejected as an invalid argument, which means nobody was interrupted to
    // approve something that could never have run.
    expect(told.content).not.toContain("did not allow");
  }, 60_000);

  it("will not clone outside the workspace", async () => {
    const root = scratch();
    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "git",
            input: {
              op: "clone",
              url: "https://github.com/owner/repo.git",
              target_dir: "../escaped",
            },
          },
        ],
      },
      { text: "Refused." },
    ]);
    await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      requestApproval: async () => true,
    }).run("clone it");

    const told = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(told.content.toLowerCase()).toContain("inside the workspace");
    expect(existsSync(join(root, "..", "escaped"))).toBe(false);
  }, 60_000);

  it("does not run when the approval is refused", async () => {
    const root = scratch();
    mkdirSync(join(root, "existing"));
    writeFileSync(join(root, "existing/work.txt"), "in progress\n");

    const provider = new MockProvider([
      {
        toolCalls: [
          {
            id: "1",
            name: "git",
            input: {
              op: "clone",
              url: "https://github.com/owner/repo.git",
              target_dir: "existing",
            },
          },
        ],
      },
      { text: "It was refused." },
    ]);
    const asked: ApprovalRequest[] = [];
    await new Orchestrator({
      provider,
      workspace: new Workspace(root),
      requestApproval: async (request) => {
        asked.push(request);
        return false;
      },
    }).run("clone it");

    // The escalation fired against a real directory with a real file in it,
    // not a stubbed probe.
    expect(asked).toHaveLength(1);
    expect(asked[0].operation).toBe("vcs.clone.into_existing");
    expect(asked[0].riskLevel).toBe("high");
    expect(existsSync(join(root, "existing/work.txt"))).toBe(true);
  }, 60_000);
});
