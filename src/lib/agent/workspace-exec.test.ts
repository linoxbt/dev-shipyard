import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace } from "./workspace";
import { executeFileTool } from "./workspace-exec";

const dirs: string[] = [];
function ws(files: Record<string, string> = {}): Workspace {
  const root = mkdtempSync(join(tmpdir(), "wex-"));
  dirs.push(root);
  const w = new Workspace(root);
  for (const [path, content] of Object.entries(files)) w.write(path, content);
  return w;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const GREET = `function greet(name) {
  return "Hello, " + name + "!";
}
`;

describe("the file tools against a real directory", () => {
  it("lists, reads and writes", () => {
    const w = ws({ "src/greet.js": GREET });
    expect(executeFileTool(w, "list_files", {})!.output).toContain("src/greet.js");
    expect(executeFileTool(w, "read_file", { path: "src/greet.js" })!.output).toContain("Hello, ");
    expect(executeFileTool(w, "write_file", { path: "a/b.txt", content: "hi" })!.ok).toBe(true);
    expect(executeFileTool(w, "read_file", { path: "a/b.txt" })!.output).toBe("hi");
  });

  it("applies a patch and reports the size of the change", () => {
    const w = ws({ "greet.js": GREET });
    const result = executeFileTool(w, "edit_file", {
      path: "greet.js",
      patch: `@@ -1,2 +1,3 @@
 function greet(name) {
+  if (!name) throw new Error("name is required");
   return "Hello, " + name + "!";`,
    })!;
    expect(result.ok).toBe(true);
    expect(result.output).toContain("+1 lines");
    expect(w.read("greet.js").ok && (w.read("greet.js") as { content: string }).content).toContain(
      "name is required",
    );
  });

  it("leaves the file byte-identical when the patch does not apply", () => {
    // The guarantee that makes patching safe to retry.
    const w = ws({ "greet.js": GREET });
    const before = readFileSync(join(w.root, "greet.js"));
    const result = executeFileTool(w, "edit_file", {
      path: "greet.js",
      patch: `@@ -1,2 +1,3 @@
 function farewell(name) {
+  nope
   return "Goodbye";`,
    })!;
    expect(result.ok).toBe(false);
    expect(result.output).toContain("did not match");
    expect(readFileSync(join(w.root, "greet.js")).equals(before)).toBe(true);
  });

  it("refuses to read a credentials file, through the tool as well as the workspace", () => {
    const w = ws();
    writeFileSync(join(w.root, ".env"), "API_KEY=sk-secret");
    const result = executeFileTool(w, "read_file", { path: ".env" })!;
    expect(result.ok).toBe(false);
    expect(result.output).not.toContain("sk-secret");
  });

  it("searches with path and line number, and says so when there is no match", () => {
    const w = ws({ "a.ts": "const token = 1;\n", "b.ts": "nothing here\n" });
    expect(executeFileTool(w, "search_files", { query: "token" })!.output).toMatch(/a\.ts:1:/);
    expect(executeFileTool(w, "search_files", { query: "zzz" })!.output).toContain("No match");
  });

  it("hands back null for anything that is not a file tool", () => {
    // Builds, tests and the outward tools are the caller's, and delete stays
    // with the gate rather than sitting in the same switch as the safe tools.
    const w = ws();
    expect(executeFileTool(w, "run_build", {})).toBeNull();
    expect(executeFileTool(w, "push_to_github", {})).toBeNull();
    expect(executeFileTool(w, "delete_file", { path: "a.ts" })).toBeNull();
  });

  it("reports a missing file rather than throwing", () => {
    const w = ws();
    const result = executeFileTool(w, "read_file", { path: "nope.ts" })!;
    expect(result.ok).toBe(false);
    expect(result.output).toContain("no file at");
  });
});
