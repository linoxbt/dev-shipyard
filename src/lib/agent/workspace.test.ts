import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Workspace, looksBinary, looksLikeSecret } from "./workspace";

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "ws-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the workspace boundary", () => {
  it("allows an ordinary path inside the root", () => {
    const root = scratch();
    writeFileSync(join(root, "app.js"), "ok");
    expect(new Workspace(root).resolve("app.js").ok).toBe(true);
  });

  it("refuses traversal out of the root", () => {
    const ws = new Workspace(scratch());
    expect(ws.resolve("../../etc/passwd").ok).toBe(false);
  });

  it("refuses an absolute path", () => {
    expect(new Workspace(scratch()).resolve("/etc/passwd").ok).toBe(false);
  });

  it("refuses a SYMLINK that points outside, which a string check would allow", () => {
    // The whole reason resolution happens on both sides. "escape/passwd" has
    // no "../" in it and sits under the root by name.
    const root = scratch();
    const outside = scratch();
    writeFileSync(join(outside, "passwd"), "secret");
    symlinkSync(outside, join(root, "escape"));

    const ws = new Workspace(root);
    const resolved = ws.resolve("escape/passwd");
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.reason).toContain("outside the workspace");
  });

  it("bounds-checks a file that does not exist yet", () => {
    // realpath throws on a missing path, but a write to a new file still has
    // to be checked.
    const ws = new Workspace(scratch());
    expect(ws.resolve("src/new/deep.ts").ok).toBe(true);
    expect(ws.resolve("../outside/new.ts").ok).toBe(false);
  });
});

describe("refusing secrets", () => {
  it("recognises credential files by name", () => {
    for (const p of [
      ".env",
      ".env.local",
      "config/.env.production",
      "key.pem",
      "server.key",
      "id_rsa",
      ".npmrc",
      "credentials.json",
      ".git-credentials",
    ]) {
      expect(looksLikeSecret(p)).toBe(true);
    }
  });

  it("does not flag ordinary source files", () => {
    for (const p of ["src/app.ts", "environment.ts", "keyboard.tsx", "README.md"]) {
      expect(looksLikeSecret(p)).toBe(false);
    }
  });

  it("refuses the read with a reason rather than returning nothing", () => {
    // A silent empty result makes the model retry the same read differently.
    const root = scratch();
    writeFileSync(join(root, ".env"), "API_KEY=sk-real-secret");
    const result = new Workspace(root).read(".env");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain("credentials file");
      // And the value itself never appears in the refusal.
      expect(result.reason).not.toContain("sk-real-secret");
    }
  });
});

describe("binary files", () => {
  it("detects a null byte", () => {
    expect(looksBinary(Buffer.from([0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
    expect(looksBinary(Buffer.from("plain text", "utf8"))).toBe(false);
  });

  it("refuses to read one as text instead of handing over mangled bytes", () => {
    const root = scratch();
    writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x00, 0x1a]));
    const result = new Workspace(root).read("logo.png");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("binary");
  });

  it("refuses to overwrite one", () => {
    const root = scratch();
    writeFileSync(join(root, "logo.png"), Buffer.from([0x89, 0x00, 0x4e]));
    expect(new Workspace(root).write("logo.png", "text").ok).toBe(false);
  });
});

describe("reading and writing", () => {
  it("round-trips a file and creates missing directories", () => {
    const ws = new Workspace(scratch());
    expect(ws.write("src/deep/app.ts", "export const x = 1;\n").ok).toBe(true);
    const read = ws.read("src/deep/app.ts");
    expect(read.ok && read.content).toBe("export const x = 1;\n");
  });

  it("says so when a file is missing or is a directory", () => {
    const root = scratch();
    mkdirSync(join(root, "src"));
    const ws = new Workspace(root);
    expect(ws.read("nope.ts").ok).toBe(false);
    expect(ws.read("src").ok).toBe(false);
  });

  it("lists text files and skips dependency and build trees", () => {
    const root = scratch();
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "node_modules"));
    mkdirSync(join(root, "dist"));
    writeFileSync(join(root, "src", "a.ts"), "a");
    writeFileSync(join(root, "node_modules", "dep.js"), "dep");
    writeFileSync(join(root, "dist", "out.js"), "out");
    expect(new Workspace(root).list()).toEqual(["src/a.ts"]);
  });
});
