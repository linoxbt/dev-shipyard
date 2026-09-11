import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detectManifests,
  installCommand,
  lintCommand,
  lockfilesFor,
  manifestForChanges,
  testCommand,
  type Manifest,
} from "./project";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "proj-"));
  dirs.push(d);
  return d;
}
function write(root: string, path: string, content: string) {
  const full = join(root, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("finding manifests", () => {
  it("finds one at the root", () => {
    const root = scratch();
    write(root, "package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    const found = detectManifests(root);
    expect(found).toHaveLength(1);
    expect(found[0].ecosystem).toBe("npm");
    expect(found[0].scripts.test).toBe("vitest");
  });

  it("finds packages in a MONOREPO with nothing useful at the root", () => {
    // The case that previously reported "no test framework found" while the
    // tests sat one directory away.
    const root = scratch();
    write(root, "packages/api/package.json", JSON.stringify({ scripts: { test: "jest" } }));
    write(root, "packages/web/package.json", JSON.stringify({ scripts: { test: "vitest" } }));
    const found = detectManifests(root);
    expect(found.map((m) => m.dir).sort()).toEqual(["packages/api", "packages/web"]);
  });

  it("does not crawl into dependency or build trees", () => {
    const root = scratch();
    write(root, "package.json", "{}");
    write(root, "node_modules/dep/package.json", "{}");
    write(root, "dist/package.json", "{}");
    expect(detectManifests(root)).toHaveLength(1);
  });

  it("survives a malformed package.json instead of throwing", () => {
    const root = scratch();
    write(root, "package.json", "{ not json");
    const found = detectManifests(root);
    expect(found).toHaveLength(1);
    expect(found[0].scripts).toEqual({});
  });

  it("recognises the other ecosystems", () => {
    const root = scratch();
    write(root, "Cargo.toml", "[package]");
    write(root, "go.mod", "module x");
    expect(
      detectManifests(root)
        .map((m) => m.ecosystem)
        .sort(),
    ).toEqual(["cargo", "go"]);
  });
});

describe("choosing the package a task concerns", () => {
  const manifests: Manifest[] = [
    { dir: "", ecosystem: "npm", file: "package.json", scripts: {} },
    { dir: "packages/api", ecosystem: "npm", file: "package.json", scripts: { test: "jest" } },
    { dir: "packages/web", ecosystem: "npm", file: "package.json", scripts: { test: "vitest" } },
  ];

  it("picks the package that owns the changed files", () => {
    // Editing the api package should run the api tests, not everything.
    const picked = manifestForChanges(manifests, ["packages/api/src/routes.ts"]);
    expect(picked?.dir).toBe("packages/api");
  });

  it("prefers the deepest match over the root", () => {
    const picked = manifestForChanges(manifests, ["packages/web/src/App.tsx"]);
    expect(picked?.dir).toBe("packages/web");
  });

  it("falls back to the root when nothing changed", () => {
    expect(manifestForChanges(manifests, [])?.dir).toBe("");
  });

  it("returns null when there is no manifest at all", () => {
    expect(manifestForChanges([], ["a.ts"])).toBeNull();
  });
});

describe("commands per ecosystem", () => {
  it("says null rather than inventing a test command", () => {
    // "This project has no tests" and "the tests failed" are different
    // answers, and conflating them makes the agent write test files nobody
    // asked for.
    expect(
      testCommand({ dir: "", ecosystem: "npm", file: "package.json", scripts: {} }),
    ).toBeNull();
    expect(
      testCommand({ dir: "", ecosystem: "npm", file: "package.json", scripts: { test: "jest" } }),
    ).toBe("npm test");
  });

  it("knows the test command for the other ecosystems", () => {
    expect(testCommand({ dir: "", ecosystem: "cargo", file: "Cargo.toml", scripts: {} })).toBe(
      "cargo test",
    );
    expect(testCommand({ dir: "", ecosystem: "go", file: "go.mod", scripts: {} })).toBe(
      "go test ./...",
    );
  });

  it("prefers lint, then typecheck, then nothing", () => {
    const base = { dir: "", ecosystem: "npm" as const, file: "package.json" };
    expect(lintCommand({ ...base, scripts: { lint: "eslint ." } })).toBe("npm run lint");
    expect(lintCommand({ ...base, scripts: { typecheck: "tsc" } })).toBe("npm run typecheck");
    expect(lintCommand({ ...base, scripts: {} })).toBeNull();
  });

  it("builds real install commands, honouring an explicit version", () => {
    expect(installCommand("npm", "zod")).toBe("npm install zod");
    expect(installCommand("npm", "vitest", { dev: true, version: "2.0.0" })).toBe(
      "npm install -D vitest@2.0.0",
    );
    expect(installCommand("pip", "httpx", { version: "0.27" })).toBe("pip install httpx==0.27");
    expect(installCommand("cargo", "serde")).toBe("cargo add serde");
    expect(installCommand("go", "github.com/x/y", { version: "v1.2.3" })).toBe(
      "go get github.com/x/y@v1.2.3",
    );
  });

  it("names the manifest and lockfiles an install would touch", () => {
    // So the result can show the actual diff rather than just "success".
    const files = lockfilesFor({
      dir: "packages/api",
      ecosystem: "npm",
      file: "package.json",
      scripts: {},
    });
    expect(files).toContain("packages/api/package.json");
    expect(files).toContain("packages/api/package-lock.json");
  });
});
