import { describe, expect, it, beforeEach } from "bun:test";

const store: Record<string, string> = {};
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};

const { useWorkspaceStore, buildTree } = await import("./workspace-store");

const reset = () =>
  useWorkspaceStore.setState({
    hydrated: false,
    activePath: "contracts/MyContract.sol",
    files: { "contracts/MyContract.sol": "// x" },
    folders: ["contracts"],
  });

describe("workspace store", () => {
  beforeEach(reset);

  it("starts deterministic so SSR and the first client render agree", () => {
    // Reading localStorage in the initialiser is what made these disagree.
    expect(useWorkspaceStore.getState().hydrated).toBe(false);
    expect(useWorkspaceStore.getState().activePath).toBe("contracts/MyContract.sol");
  });

  it("holds any file type, not just .sol", () => {
    const s = useWorkspaceStore.getState();
    s.addFile("app/index.html", "<!doctype html>");
    s.addFile("app/styles.css", "body{}");
    s.addFile("app/contract.js", "export const ADDRESS = '0x1';");
    const files = useWorkspaceStore.getState().files;
    expect(Object.keys(files)).toContain("app/index.html");
    expect(files["app/contract.js"]).toContain("ADDRESS");
  });

  it("writeFiles adds a whole project WITHOUT stealing the active file", () => {
    // The generator emits many files; yanking the user out of what they were
    // reading would be hostile.
    const before = useWorkspaceStore.getState().activePath;
    useWorkspaceStore.getState().writeFiles([
      { path: "app/index.html", content: "a" },
      { path: "app/app.js", content: "b" },
    ]);
    const s = useWorkspaceStore.getState();
    expect(s.activePath).toBe(before);
    expect(s.files["app/app.js"]).toBe("b");
    expect(s.folders).toContain("app");
  });

  it("importEntries DOES focus the first file (an explicit user upload)", () => {
    useWorkspaceStore.getState().importEntries([{ path: "up/a.txt", content: "a" }]);
    expect(useWorkspaceStore.getState().activePath).toBe("up/a.txt");
  });

  it("infers nested folders from paths", () => {
    useWorkspaceStore.getState().writeFiles([{ path: "a/b/c/deep.js", content: "x" }]);
    const folders = useWorkspaceStore.getState().folders;
    expect(folders).toContain("a");
    expect(folders).toContain("a/b");
    expect(folders).toContain("a/b/c");
  });

  it("renames a folder and everything under it", () => {
    const s = useWorkspaceStore.getState();
    s.writeFiles([
      { path: "app/one.js", content: "1" },
      { path: "app/sub/two.js", content: "2" },
    ]);
    useWorkspaceStore.getState().renameFile("app", "site");
    const files = useWorkspaceStore.getState().files;
    expect(files["site/one.js"]).toBe("1");
    expect(files["site/sub/two.js"]).toBe("2");
    expect(files["app/one.js"]).toBeUndefined();
  });

  it("never leaves the workspace empty", () => {
    useWorkspaceStore.getState().deleteFile("contracts/MyContract.sol");
    expect(Object.keys(useWorkspaceStore.getState().files).length).toBeGreaterThan(0);
  });

  it("persists to localStorage and hydrates back", () => {
    useWorkspaceStore.getState().writeFiles([{ path: "app/x.js", content: "kept" }]);
    reset();
    useWorkspaceStore.getState().hydrate();
    const s = useWorkspaceStore.getState();
    expect(s.hydrated).toBe(true);
    expect(s.files["app/x.js"]).toBe("kept");
  });
});

describe("buildTree", () => {
  it("nests by path, directories before files", () => {
    const t = buildTree({ "a/b.js": "1", "top.js": "2" }, ["a"]);
    expect(t.children[0].type).toBe("dir");
    expect(t.children[0].path).toBe("a");
    expect(t.children[1].path).toBe("top.js");
  });
});
