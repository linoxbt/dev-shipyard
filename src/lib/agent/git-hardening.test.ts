import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "./shell";
import { agentDiff, changedFiles, checkpoint, driverOverrides, headIsCheckpoint } from "./git";
import { gitArgsProblem } from "./git-ops";
import { initLocalRepo, materialise } from "./repo-session";
import { Workspace, isControlPath } from "./workspace";

// A planted .git/config was a host shell on the next checkpoint. These prove
// both halves of the fix: the workspace will not write it, and git does not
// run what a config file names even when one gets there another way (a
// sandboxed command shares the workspace mount).

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "githard-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("control paths", () => {
  it("are recognised on any segment", () => {
    for (const p of [
      ".git/config",
      "sub/.git/hooks/pre-commit",
      ".mcp.json",
      "a/.mcp.json",
      ".devstation/mcp.json",
      ".agent/x",
      ".GIT/config",
    ]) {
      expect(isControlPath(p)).toBe(true);
    }
    for (const p of [".gitignore", ".gitattributes", "src/git.ts", ".github/workflows/ci.yml"]) {
      expect(isControlPath(p)).toBe(false);
    }
  });

  it("are refused by Workspace.write", () => {
    const ws = new Workspace(scratch());
    expect(ws.write(".git/config", "[core]\n").ok).toBe(false);
    expect(ws.write(".mcp.json", "{}").ok).toBe(false);
    expect(ws.write("src/a.ts", "x").ok).toBe(true);
  });

  it("are refused when uploaded, and never become a configured repository", async () => {
    const root = scratch();
    const marker = join(root, "..", `pwned-${Date.now()}`);
    const out = materialise(
      {
        ".git/config": `[core]\n\tfsmonitor = touch ${marker}\n[filter "x"]\n\tclean = touch ${marker}\n`,
        ".gitattributes": "* filter=x\n",
        "index.js": "1",
      },
      root,
    );
    expect(out.refused.map((r) => r.path)).toEqual([".git/config"]);
    expect(await initLocalRepo(root, "test")).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});

describe("host git ignores programs named by config", () => {
  it("does not run fsmonitor, filters, textconv or hooks from .git/config", async () => {
    const root = scratch();
    await runShell(
      "git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base",
      { cwd: root },
    );
    const marker = join(root, "..", `pwned-${Date.now()}-${Math.random()}`);
    appendFileSync(
      join(root, ".git", "config"),
      `[core]\n\tfsmonitor = touch ${marker}-fs\n\thooksPath = hooks\n` +
        `[filter "x"]\n\tclean = touch ${marker}-clean\n\tsmudge = touch ${marker}-smudge\n` +
        `[diff "x"]\n\ttextconv = touch ${marker}-tc\n`,
    );
    writeFileSync(join(root, ".gitattributes"), "*.txt filter=x diff=x\n");
    writeFileSync(join(root, "a.txt"), "hello\n");

    expect(driverOverrides(root)).toEqual(
      expect.arrayContaining(["filter.x.clean=", "filter.x.smudge=", "diff.x.textconv="]),
    );
    await changedFiles(root);
    const cp = await checkpoint(root, "one");
    expect(cp.ok).toBe(true);
    writeFileSync(join(root, "a.txt"), "changed\n");
    await agentDiff(root);

    for (const suffix of ["-fs", "-clean", "-smudge", "-tc"]) {
      expect(existsSync(marker + suffix)).toBe(false);
    }
  });

  it("leaves the stock git-lfs filter alone", () => {
    const root = scratch();
    writeFileSync(join(root, "x"), "");
    return runShell("git init -q", { cwd: root }).then(() => {
      appendFileSync(
        join(root, ".git", "config"),
        '[filter "lfs"]\n\tclean = git-lfs clean -- %f\n\tprocess = git-lfs filter-process\n',
      );
      expect(driverOverrides(root)).toEqual([]);
    });
  });
});

describe("signature checks and work-tree redirection", () => {
  it("never starts a gpg program named by config, even for a signed commit", async () => {
    const root = scratch();
    await runShell(
      "git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base",
      { cwd: root },
    );
    // A commit carrying a gpgsig header, written directly: git only calls the
    // verifier for commits that have one.
    const tree = (await runShell("git rev-parse HEAD^{tree}", { cwd: root })).stdout.trim();
    const parent = (await runShell("git rev-parse HEAD", { cwd: root })).stdout.trim();
    const body =
      `tree ${tree}\nparent ${parent}\nauthor t <t@t> 1700000000 +0000\n` +
      `committer t <t@t> 1700000000 +0000\ngpgsig -----BEGIN PGP SIGNATURE-----\n \n` +
      ` x\n -----END PGP SIGNATURE-----\n\nsigned\n`;
    writeFileSync(join(root, "..", "commit.txt"), body);
    const sha = (
      await runShell(`git hash-object -t commit -w ${join(root, "..", "commit.txt")}`, {
        cwd: root,
      })
    ).stdout.trim();
    await runShell(`git update-ref HEAD ${sha}`, { cwd: root });

    const marker = join(root, "..", `gpg-${Date.now()}-${Math.random()}`);
    const program = join(root, "..", "verifier.sh");
    writeFileSync(program, `#!/bin/sh\ntouch ${marker}\n`, { mode: 0o755 });
    appendFileSync(
      join(root, ".git", "config"),
      `[gpg]\n\tprogram = ${program}\n[log]\n\tshowSignature = true\n`,
    );
    // Sanity: plain git does start it, so the test would catch a regression.
    await runShell("git log -1", { cwd: root });
    expect(existsSync(marker)).toBe(true);
    rmSync(marker);

    await headIsCheckpoint(root);
    await changedFiles(root);
    expect(existsSync(marker)).toBe(false);
    expect(gitArgsProblem("log", ["--format=%G?"])).not.toBeNull();
    expect(gitArgsProblem("log", ["--format", "%GS"])).not.toBeNull();
  });

  it("keeps the work tree on the workspace whatever core.worktree says", async () => {
    const root = scratch();
    const elsewhere = scratch();
    writeFileSync(join(elsewhere, "secret.env"), "HOST_SECRET=hunter2\n");
    await runShell(
      "git init -q && git -c user.name=t -c user.email=t@t commit -q --allow-empty -m base",
      { cwd: root },
    );
    appendFileSync(join(root, ".git", "config"), `[core]\n\tworktree = ${elsewhere}\n`);
    writeFileSync(join(root, "a.txt"), "mine\n");
    const cp = await checkpoint(root, "one");
    expect(cp.ok).toBe(true);
    const files = (
      await runShell("git -c core.worktree= ls-tree -r --name-only HEAD", { cwd: root })
    ).stdout;
    expect(files).toContain("a.txt");
    expect(files).not.toContain("secret.env");
  });
});

describe("gitArgsProblem", () => {
  it("refuses flags that run programs or write files", () => {
    for (const [op, args] of [
      ["log", ["-1", "--format=x", "--output=/tmp/x"]],
      ["diff", ["--ext-diff"]],
      ["show", ["--textconv"]],
      ["log", ["--exec-path=/tmp"]],
      ["status", ["-c", "core.pager=sh"]],
      ["branch", ["--upload-pack=x"]],
      ["commit", ["--amend"]],
    ] as const) {
      expect(gitArgsProblem(op, args)).not.toBeNull();
    }
  });

  it("accepts short flags with attached values and bundles of allowed letters", () => {
    expect(gitArgsProblem("commit", ["-am", "msg"])).toBeNull();
    expect(gitArgsProblem("commit", ["-mfix"])).toBeNull();
    expect(gitArgsProblem("checkout", ["-bfeature"])).toBeNull();
    // A bundle with any letter that is not allowed alone is still refused.
    expect(gitArgsProblem("commit", ["-ac"])).not.toBeNull();
    expect(gitArgsProblem("status", ["-cfoo"])).not.toBeNull();
  });

  it("accepts ordinary reads", () => {
    expect(gitArgsProblem("log", ["-5", "--oneline"])).toBeNull();
    expect(gitArgsProblem("log", ["-n", "3", "--format=%h %s"])).toBeNull();
    expect(gitArgsProblem("diff", ["--stat", "-U3", "HEAD~1", "--", "--weird-file"])).toBeNull();
    expect(gitArgsProblem("commit", ["-m", "msg"])).toBeNull();
  });
});
