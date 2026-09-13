import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasSnapshots, listSnapshots, takeSnapshot, undoSnapshot } from "./snapshots";
import { MockProvider } from "./providers";
import { Orchestrator } from "./orchestrator";
import { Workspace } from "./workspace";

// Undo, in a workspace with no git.
//
// The claim under test is not "a file was copied". It is that undo puts the
// workspace back to what it was: the same promise the git path makes, in a
// place git is not.

const dirs: string[] = [];
function scratch(files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "snap-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const read = (root: string, path: string) => readFileSync(join(root, path), "utf8");

describe("taking a snapshot", () => {
  it("captures what the agent can see", () => {
    const root = scratch({ "a.js": "one\n", "src/b.js": "two\n" });
    const snap = takeSnapshot(root, "first");
    expect(snap).not.toBeNull();
    expect(snap!.files.sort()).toEqual(["a.js", "src/b.js"]);
    expect(hasSnapshots(root)).toBe(true);
  });

  it("does not copy the things the workspace skips", () => {
    // A checkpoint of a project with dependencies installed would otherwise
    // copy tens of thousands of files nobody wants back.
    const root = scratch({ "a.js": "one\n", "node_modules/pkg/index.js": "dep\n" });
    const snap = takeSnapshot(root, "first");
    expect(snap!.files).toEqual(["a.js"]);
  });

  it("does not snapshot its own store", () => {
    const root = scratch({ "a.js": "one\n" });
    takeSnapshot(root, "first");
    const second = takeSnapshot(root, "second");
    expect(second!.files.some((f) => f.startsWith(".devstation/"))).toBe(false);
  });
});

describe("undoing", () => {
  it("puts a changed file back", () => {
    const root = scratch({ "a.js": "original\n" });
    takeSnapshot(root, "before the change");
    writeFileSync(join(root, "a.js"), "modified\n");

    expect(undoSnapshot(root).ok).toBe(true);
    expect(read(root, "a.js")).toBe("original\n");
  });

  it("removes a file the turn added", () => {
    // The half that makes this an undo rather than a merge. A turn that added
    // three files and changed one is not undone by restoring the one.
    const root = scratch({ "a.js": "original\n" });
    takeSnapshot(root, "before");
    writeFileSync(join(root, "added.js"), "new\n");

    undoSnapshot(root);
    expect(existsSync(join(root, "added.js"))).toBe(false);
    expect(read(root, "a.js")).toBe("original\n");
  });

  it("restores a file the turn deleted", () => {
    const root = scratch({ "a.js": "original\n", "b.js": "keep\n" });
    takeSnapshot(root, "before");
    rmSync(join(root, "b.js"));

    undoSnapshot(root);
    expect(read(root, "b.js")).toBe("keep\n");
  });

  it("goes back one turn at a time", () => {
    const root = scratch({ "a.js": "v1\n" });
    takeSnapshot(root, "at v1");
    writeFileSync(join(root, "a.js"), "v2\n");
    takeSnapshot(root, "at v2");
    writeFileSync(join(root, "a.js"), "v3\n");

    expect(undoSnapshot(root).message).toContain("at v2");
    expect(read(root, "a.js")).toBe("v2\n");
    expect(undoSnapshot(root).message).toContain("at v1");
    expect(read(root, "a.js")).toBe("v1\n");
  });

  it("orders by turn, not by the clock", () => {
    // What CI caught and this machine hid. Three snapshots taken with no delay
    // land in the same millisecond on a fast machine; ordering them by
    // timestamp then fell back to a random suffix, so undo rewound to whichever
    // sorted highest rather than to the most recent.
    const root = scratch({ "a.js": "v1\n" });
    takeSnapshot(root, "at v1");
    writeFileSync(join(root, "a.js"), "v2\n");
    takeSnapshot(root, "at v2");
    writeFileSync(join(root, "a.js"), "v3\n");
    takeSnapshot(root, "at v3");

    expect(listSnapshots(root).map((s) => s.message)).toEqual(["at v3", "at v2", "at v1"]);
    // And they really were simultaneous, or this proves nothing.
    const times = listSnapshots(root).map((s) => Number(s.id.split("-")[1]));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(50);
  });

  it("says so when there is nothing to undo", () => {
    const result = undoSnapshot(scratch({ "a.js": "x\n" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no checkpoint");
  });

  it("keeps a bounded history", () => {
    const root = scratch({ "a.js": "0\n" });
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(root, "a.js"), `${i}\n`);
      takeSnapshot(root, `turn ${i}`);
    }
    // Bounded, so a long session does not quietly fill a disk with copies.
    expect(listSnapshots(root).length).toBeLessThanOrEqual(20);
    // And it is the OLDEST that go.
    expect(listSnapshots(root)[0].message).toBe("turn 24");
  });
});

describe("the agent's own safety net, with no git", () => {
  it("checkpoints a turn that changed a file", async () => {
    const root = scratch({ "a.js": "original\n" });
    expect(existsSync(join(root, ".git"))).toBe(false);

    const provider = new MockProvider([
      {
        toolCalls: [{ id: "1", name: "write_file", input: { path: "a.js", content: "changed\n" } }],
      },
      { text: "Changed it." },
    ]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("change a.js");

    // The whole point: undo exists here, and it works.
    expect(read(root, "a.js")).toBe("changed\n");
    expect(hasSnapshots(root)).toBe(true);
    expect(undoSnapshot(root).ok).toBe(true);
    expect(read(root, "a.js")).toBe("original\n");
  }, 30_000);

  it("does not checkpoint a turn that changed nothing", async () => {
    const root = scratch({ "a.js": "original\n" });
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "read_file", input: { path: "a.js" } }] },
      { text: "Read it." },
    ]);
    await new Orchestrator({ provider, workspace: new Workspace(root) }).run("read a.js");
    expect(hasSnapshots(root)).toBe(false);
  }, 30_000);
});

describe("snapshots that must not be taken", () => {
  it("never copies a home directory, and says why", () => {
    // The bug this holds: once /root stopped counting as a git repository, the
    // first turn there copied the home directory aside -- 3.9GB in two runs.
    const root = scratch({ "a.js": "x\n" });
    const reasons: string[] = [];
    const snap = takeSnapshot(root, "turn", { home: root, onSkip: (r) => reasons.push(r) });
    expect(snap).toBeNull();
    expect(reasons.join(" ")).toContain("home directory");
    expect(existsSync(join(root, ".devstation", "checkpoints"))).toBe(false);
  });

  it("refuses a tree over the file limit without copying anything", () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 6; i++) files[`f${i}.js`] = `${i}\n`;
    const root = scratch(files);
    const reasons: string[] = [];
    expect(
      takeSnapshot(root, "turn", { home: "", maxFiles: 3, onSkip: (r) => reasons.push(r) }),
    ).toBeNull();
    expect(reasons.join(" ")).toContain("too large");
    expect(existsSync(join(root, ".devstation", "checkpoints"))).toBe(false);
  });

  it("refuses a tree over the size limit", () => {
    const root = scratch({ "big.txt": "x".repeat(4096) });
    const reasons: string[] = [];
    expect(
      takeSnapshot(root, "turn", { home: "", maxBytes: 1024, onSkip: (r) => reasons.push(r) }),
    ).toBeNull();
    expect(reasons.length).toBe(1);
  });

  it("still gives a hidden project folder a way back", () => {
    // Snapshots skip build output, not a project's own dot-folders.
    const root = scratch({ ".vscode/settings.json": "{}\n" });
    takeSnapshot(root, "before", { home: "" });
    writeFileSync(join(root, ".vscode/settings.json"), '{"changed":true}\n');
    expect(undoSnapshot(root).ok).toBe(true);
    expect(read(root, ".vscode/settings.json")).toBe("{}\n");
  });

  it("stays silent, and stops trying, when it refuses", async () => {
    const root = scratch({ "a.js": "original\n" });
    const realHome = process.env.HOME;
    process.env.HOME = root;
    try {
      const provider = new MockProvider([
        { toolCalls: [{ id: "1", name: "write_file", input: { path: "a.js", content: "one\n" } }] },
        { toolCalls: [{ id: "2", name: "write_file", input: { path: "a.js", content: "two\n" } }] },
        { text: "Done." },
      ]);
      const notices: string[] = [];
      await new Orchestrator({
        provider,
        workspace: new Workspace(root),
        onEvent: (e) => {
          if (e.message.startsWith("No undo")) notices.push(e.message);
        },
      }).run("edit twice");
      // Nothing said to the person: a missing undo is not worth interrupting for.
      expect(notices).toHaveLength(0);
      expect(existsSync(join(root, ".devstation", "checkpoints"))).toBe(false);
    } finally {
      process.env.HOME = realHome;
    }
  }, 30_000);
});
