import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readWorkspaceBounded } from "../repo-session";
import { Workspace } from "../workspace";
import { indexWorkspace, openStore } from "./workspace-index";

// The index must cost a bounded wait on any tree, however large.
//
// `devstation` in /root sat silent for minutes because the index read every
// file under it -- about 495,000, most in hidden tool caches -- on the main
// thread before the first turn.

const dirs: string[] = [];
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "bounds-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the index's walk", () => {
  it("skips hidden tool caches but keeps .github", () => {
    const root = tree({
      "src/app.ts": "export const x = 1;\n",
      ".github/workflows/ci.yml": "on: push\n",
      ".cache/huge/blob.txt": "cache\n",
      ".bun/install/cache/pkg/index.js": "cache\n",
      "target/debug/build.txt": "rust build output\n",
    });
    const { files, stopped } = readWorkspaceBounded(root);
    expect(Object.keys(files).sort()).toEqual([".github/workflows/ci.yml", "src/app.ts"]);
    expect(stopped).toBeNull();
  });

  it("stops at the file limit and says so", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 30; i++) many[`f${i}.txt`] = `file ${i}\n`;
    const { files, stopped } = readWorkspaceBounded(tree(many), { maxFiles: 10 });
    expect(Object.keys(files).length).toBe(10);
    expect(stopped).toBe("max-files");
  });

  it("stops at the deadline and says so", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 200; i++) many[`d${i % 10}/f${i}.txt`] = `file ${i}\n`;
    const { stopped } = readWorkspaceBounded(tree(many), { deadlineMs: -1 });
    expect(stopped).toBe("deadline");
  });
});

describe("indexing a workspace", () => {
  it("does not index a home directory at all", async () => {
    const root = tree({ "a.ts": "x\n" });
    const result = await indexWorkspace(root, { home: root, store: openStore(tree({})) });
    expect(result.stopped).toBe("home");
    expect(result.scanned).toBe(0);
  });

  it("keeps entries it did not reach when a pass stops early", async () => {
    // A bounded walk knows nothing about what lay beyond its limit. Treating
    // unreached files as deleted would empty the index a little every pass.
    const files: Record<string, string> = {};
    for (let i = 0; i < 20; i++)
      files[`f${String(i).padStart(2, "0")}.ts`] = `export const v${i} = ${i};\n`;
    const root = tree(files);
    const store = openStore(root);

    const full = await indexWorkspace(root, { store, home: "" });
    expect(full.stopped).toBeNull();
    expect(full.scanned).toBe(20);

    const partial = await indexWorkspace(root, { store, home: "", maxFiles: 5 });
    expect(partial.stopped).toBe("max-files");
    expect(partial.removed).toBe(0);
    store.close();
  });

  it("still removes files that are really gone after a complete pass", async () => {
    const root = tree({ "keep.ts": "a\n", "gone.ts": "b\n" });
    const store = openStore(root);
    await indexWorkspace(root, { store, home: "" });
    rmSync(join(root, "gone.ts"));
    const again = await indexWorkspace(root, { store, home: "" });
    expect(again.removed).toBe(1);
    store.close();
  });
});

describe("listing files", () => {
  it("stops walking once it has enough", () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 50; i++) many[`d${i % 5}/f${i}.txt`] = "x\n";
    const workspace = new Workspace(tree(many));
    expect(workspace.list(".", 12).length).toBe(12);
    expect(workspace.list(".").length).toBe(50);
  });
});
