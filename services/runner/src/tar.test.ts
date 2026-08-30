import { describe, expect, it } from "bun:test";
import { packTar, unpackTar } from "./tar";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("tar", () => {
  const files = {
    "package.json": '{"name":"x"}\n',
    "src/app.js": "export const x = 1;\n",
    "src/deep/nested/styles.css": "body{color:red}\n",
    "unicode.md": "# héllo — ünicode ✓\n",
  };

  it("produces an archive REAL tar can extract byte-for-byte", () => {
    // docker cp consumes this; if GNU tar cannot read it, docker will not either.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-"));
    const archive = path.join(dir, "a.tar");
    fs.writeFileSync(archive, packTar(files));
    execFileSync("tar", ["-xf", archive, "-C", dir]);
    for (const [name, content] of Object.entries(files)) {
      expect(`${name}: ${fs.readFileSync(path.join(dir, name), "utf8")}`).toBe(
        `${name}: ${content}`,
      );
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes tar's own listing without checksum complaints", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-"));
    const archive = path.join(dir, "a.tar");
    fs.writeFileSync(archive, packTar(files));
    // A bad checksum makes tar warn or fail here.
    const out = execFileSync("tar", ["-tvf", archive]).toString();
    expect(out).toContain("package.json");
    expect(out).toContain("src/deep/nested/styles.css");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips through its own reader", () => {
    const entries = unpackTar(packTar(files));
    const back = Object.fromEntries(entries.map((e) => [e.path, e.content.toString("utf8")]));
    expect(back).toEqual(files);
  });

  it("reads an archive produced by REAL tar", () => {
    // Build output comes back from `docker cp`, i.e. GNU tar's output.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-"));
    fs.mkdirSync(path.join(dir, "dist/assets"), { recursive: true });
    fs.writeFileSync(path.join(dir, "dist/index.html"), "<h1>hi</h1>");
    fs.writeFileSync(path.join(dir, "dist/assets/app.js"), "console.log(1)");
    const archive = path.join(dir, "d.tar");
    execFileSync("tar", ["-cf", archive, "-C", dir, "dist"]);
    const entries = unpackTar(fs.readFileSync(archive));
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toContain("dist/index.html");
    expect(paths).toContain("dist/assets/app.js");
    expect(entries.find((e) => e.path === "dist/index.html")!.content.toString()).toBe(
      "<h1>hi</h1>",
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores directory entries rather than treating them as files", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tar-"));
    fs.mkdirSync(path.join(dir, "d/sub"), { recursive: true });
    fs.writeFileSync(path.join(dir, "d/sub/a.txt"), "a");
    const archive = path.join(dir, "x.tar");
    execFileSync("tar", ["-cf", archive, "-C", dir, "d"]);
    const entries = unpackTar(fs.readFileSync(archive));
    expect(entries.every((e) => !e.path.endsWith("/"))).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
