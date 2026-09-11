import { describe, expect, it } from "bun:test";
import { gzipSync } from "node:zlib";
import { filesFromArchive, readTar, readTarGz, stripTopLevel } from "./repo-archive";

// Archives are built here rather than checked in, so a test says exactly which
// tar feature it is about.

const BLOCK = 512;

function header(opts: { name: string; size: number; type?: string; prefix?: string }): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(opts.name.slice(0, 100), 0, "utf8");
  block.write("000644 \0", 100);
  block.write(`${opts.size.toString(8).padStart(11, "0")} `, 124);
  block.write(`${Math.floor(Date.now() / 1000).toString(8)} `, 136);
  block.write(opts.type ?? "0", 156);
  block.write("ustar\0" + "00", 257);
  if (opts.prefix) block.write(opts.prefix.slice(0, 155), 345, "utf8");
  // The checksum is not verified by the reader, so spaces are enough here.
  block.write("        ", 148);
  return block;
}

function pad(buf: Buffer): Buffer {
  const extra = (BLOCK - (buf.length % BLOCK)) % BLOCK;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra)]) : buf;
}

function entry(name: string, content: Buffer | string, type?: string, prefix?: string): Buffer {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return Buffer.concat([header({ name, size: body.length, type, prefix }), pad(body)]);
}

function archive(...parts: Buffer[]): Buffer {
  return Buffer.concat([...parts, Buffer.alloc(BLOCK * 2)]);
}

describe("reading a tar", () => {
  it("reads ordinary files", () => {
    const entries = readTar(archive(entry("a.txt", "one"), entry("b/c.txt", "two")));
    expect(entries.map((e) => e.path)).toEqual(["a.txt", "b/c.txt"]);
    expect(entries[1].content.toString()).toBe("two");
  });

  it("joins the ustar prefix to the name", () => {
    const entries = readTar(archive(entry("c.txt", "x", "0", "deep/nested/dir")));
    expect(entries[0].path).toBe("deep/nested/dir/c.txt");
  });

  it("takes the path from a pax header rather than truncating it", () => {
    // This is what git archive emits for a path over 100 characters, and it is
    // the case that silently puts a file in the wrong place.
    const long = `${"a-long-directory-name/".repeat(6)}file.ts`;
    expect(long.length).toBeGreaterThan(100);
    const record = `${`${String(`path=${long}\n`.length + 4)} path=${long}\n`}`;
    const entries = readTar(
      archive(entry("PaxHeaders/0", record, "x"), entry(long.slice(0, 100), "real content")),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(long);
    expect(entries[0].content.toString()).toBe("real content");
  });

  it("takes the path from a GNU long-name record", () => {
    const long = `${"b/".repeat(60)}file.ts`;
    const entries = readTar(
      archive(entry("././@LongLink", `${long}\0`, "L"), entry(long.slice(0, 100), "content")),
    );
    expect(entries[0].path).toBe(long);
  });

  it("applies a pax path to the next entry only", () => {
    const long = `${"c/".repeat(60)}one.ts`;
    const record = `${String(`path=${long}\n`.length + 4)} path=${long}\n`;
    const entries = readTar(
      archive(
        entry("PaxHeaders/0", record, "x"),
        entry(long.slice(0, 100), "first"),
        entry("plain.ts", "second"),
      ),
    );
    expect(entries.map((e) => e.path)).toEqual([long, "plain.ts"]);
  });

  it("ignores directories, symlinks and global headers", () => {
    const entries = readTar(
      archive(
        entry("dir/", "", "5"),
        entry("link.txt", "", "2"),
        entry("pax_global_header", "junk", "g"),
        entry("real.txt", "kept"),
      ),
    );
    expect(entries.map((e) => e.path)).toEqual(["real.txt"]);
  });

  it("reads a gzipped archive, and an uncompressed one too", () => {
    const raw = archive(entry("a.txt", "hello"));
    expect(readTarGz(gzipSync(raw))[0].content.toString()).toBe("hello");
    expect(readTarGz(raw)[0].content.toString()).toBe("hello");
  });
});

describe("the wrapper directory GitHub adds", () => {
  it("strips it when every entry shares it", () => {
    const stripped = stripTopLevel([
      { path: "linoxbt-repo-abc123/src/a.ts", content: Buffer.from("x") },
      { path: "linoxbt-repo-abc123/README.md", content: Buffer.from("y") },
    ]);
    expect(stripped.map((e) => e.path)).toEqual(["src/a.ts", "README.md"]);
  });

  it("leaves the paths alone when they do not share one", () => {
    const entries = [
      { path: "a/one.ts", content: Buffer.from("x") },
      { path: "b/two.ts", content: Buffer.from("y") },
    ];
    expect(stripTopLevel(entries).map((e) => e.path)).toEqual(["a/one.ts", "b/two.ts"]);
  });
});

describe("turning an archive into a workspace", () => {
  const wrap = (name: string) => `repo-sha/${name}`;

  it("keeps source and reports what it left out", () => {
    const result = filesFromArchive(
      [
        { path: wrap("src/a.ts"), content: Buffer.from("export const a = 1;\n") },
        { path: wrap("logo.png"), content: Buffer.from([0x89, 0x50, 0x00, 0x01]) },
        { path: wrap("huge.txt"), content: Buffer.alloc(2000, 0x61) },
      ],
      { maxFileBytes: 1000 },
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(Object.keys(result.files)).toEqual(["src/a.ts"]);
    expect(result.skipped.find((s) => s.path === "logo.png")?.why).toBe("binary");
    expect(result.skipped.find((s) => s.path === "huge.txt")?.why).toContain("larger than");
  });

  it("never lets a path climb out of the workspace", () => {
    const result = filesFromArchive([
      { path: wrap("../escape.ts"), content: Buffer.from("x") },
      { path: wrap("a/../../escape2.ts"), content: Buffer.from("x") },
      { path: wrap("fine.ts"), content: Buffer.from("x") },
    ]);
    if ("error" in result) throw new Error(result.error);
    expect(Object.keys(result.files)).toEqual(["fine.ts"]);
    expect(result.skipped.map((s) => s.why)).toEqual([
      "the path leaves the repository",
      "the path leaves the repository",
    ]);
  });

  it("refuses an absolute path", () => {
    const result = filesFromArchive([{ path: "/etc/passwd", content: Buffer.from("x") }]);
    if ("error" in result) throw new Error(result.error);
    expect(result.files).toEqual({});
    expect(result.skipped[0].why).toBe("the path leaves the repository");
  });

  it("leaves out the directories that are never worth reading", () => {
    const result = filesFromArchive([
      { path: wrap(".git/objects/ab/cdef"), content: Buffer.from("x") },
      { path: wrap("node_modules/left-pad/index.js"), content: Buffer.from("x") },
      { path: wrap("src/index.ts"), content: Buffer.from("x") },
    ]);
    if ("error" in result) throw new Error(result.error);
    expect(Object.keys(result.files)).toEqual(["src/index.ts"]);
    // Not "skipped": these were never candidates, and listing every object in
    // .git would bury the files that really were left out.
    expect(result.skipped).toHaveLength(0);
  });

  it("says the repository is too big rather than handing over half of it", () => {
    const entries = Array.from({ length: 12 }, (_, i) => ({
      path: wrap(`f${i}.ts`),
      content: Buffer.from("x"),
    }));
    const result = filesFromArchive(entries, { maxFiles: 10 });
    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error).toContain("more than the agent can hold");
  });

  it("stops on total size as well as file count", () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({
      path: wrap(`f${i}.ts`),
      content: Buffer.alloc(400, 0x61),
    }));
    const result = filesFromArchive(entries, { maxBytes: 1000 });
    expect("error" in result).toBe(true);
  });
});
