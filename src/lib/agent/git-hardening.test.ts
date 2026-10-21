import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell } from "./shell";
import { agentDiff, changedFiles, checkpoint, driverOverrides } from "./git";
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

  it("accepts ordinary reads", () => {
    expect(gitArgsProblem("log", ["-5", "--oneline"])).toBeNull();
    expect(gitArgsProblem("log", ["-n", "3", "--format=%h %s"])).toBeNull();
    expect(gitArgsProblem("diff", ["--stat", "-U3", "HEAD~1", "--", "--weird-file"])).toBeNull();
    expect(gitArgsProblem("commit", ["-m", "msg"])).toBeNull();
  });
});
