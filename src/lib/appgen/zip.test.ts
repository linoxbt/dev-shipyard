import { describe, expect, it } from "bun:test";
import { createZip } from "./zip";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("createZip", () => {
  const files = {
    "app/index.html": "<!doctype html><title>hi</title>",
    "app/app.js": 'export const x = "hello";\n',
    "app/nested/deep/styles.css": "body { color: red }",
    "app/unicode.md": "# héllo: ünicode ✓\n",
  };

  it("produces an archive a REAL unzip can read back byte-for-byte", () => {
    // The only test that matters here: does a standard tool accept it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-"));
    const zipPath = path.join(dir, "out.zip");
    fs.writeFileSync(zipPath, createZip(files));

    execFileSync("unzip", ["-qq", "-o", zipPath, "-d", path.join(dir, "x")]);
    for (const [name, content] of Object.entries(files)) {
      const got = fs.readFileSync(path.join(dir, "x", name), "utf8");
      expect(`${name}: ${got}`).toBe(`${name}: ${content}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes unzip's own integrity check (CRCs are right)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-"));
    const zipPath = path.join(dir, "out.zip");
    fs.writeFileSync(zipPath, createZip(files));
    // -t verifies every entry's CRC; a wrong checksum fails here.
    const out = execFileSync("unzip", ["-t", zipPath]).toString();
    expect(out).toContain("No errors detected");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("emits a valid trailer for an empty archive", () => {
    // `unzip -t` exits non-zero on an empty archive by design, so assert the
    // structure directly: 22 bytes, End Of Central Directory signature, zero
    // entries. A malformed trailer here corrupts every archive.
    const zip = createZip({});
    expect(zip.length).toBe(22);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    expect([...zip.slice(8, 12)]).toEqual([0, 0, 0, 0]); // entry counts
  });

  it("keeps every file's bytes exact, including UTF-8", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zip-"));
    const zipPath = path.join(dir, "u.zip");
    fs.writeFileSync(zipPath, createZip({ "u.md": files["app/unicode.md"] }));
    execFileSync("unzip", ["-qq", "-o", zipPath, "-d", path.join(dir, "x")]);
    expect(fs.readFileSync(path.join(dir, "x", "u.md"), "utf8")).toBe(files["app/unicode.md"]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
