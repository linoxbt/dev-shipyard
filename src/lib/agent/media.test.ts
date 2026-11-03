import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byteRange, mediaType, shareFile, sharedFile } from "./media";
import { Workspace } from "./workspace";
import { downloadRanges, MEDIA_CHUNK, mediaRange } from "../coding-agent/media-range";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "media-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("share_file", () => {
  it("keeps a copy of the file under an id, which survives the original", () => {
    writeFileSync(join(root, "out.mp4"), Buffer.alloc(2048, 7));
    const shared = shareFile(new Workspace(root), "out.mp4", "  The cut  ");
    expect(shared.ok).toBe(true);
    if (!shared.ok) return;
    expect(shared.media).toMatchObject({
      name: "out.mp4",
      size: 2048,
      type: "video/mp4",
      kind: "video",
      caption: "The cut",
    });
    expect(shared.output).toContain("play it there");
    rmSync(join(root, "out.mp4"));
    const found = sharedFile(root, shared.media.id);
    expect(found?.media.name).toBe("out.mp4");
    expect(readFileSync(found!.path).length).toBe(2048);
  });

  it("refuses what is not a shareable file", () => {
    const ws = new Workspace(root);
    writeFileSync(join(root, ".env"), "KEY=1");
    writeFileSync(join(root, "empty.txt"), "");
    expect(shareFile(ws, ".env").ok).toBe(false);
    expect(shareFile(ws, "../outside.mp4").ok).toBe(false);
    expect(shareFile(ws, "/etc/passwd").ok).toBe(false);
    expect(shareFile(ws, "missing.mp4").ok).toBe(false);
    expect(shareFile(ws, "empty.txt").ok).toBe(false);
    expect(shareFile(ws, ".devstation/shots/x.jpg").ok).toBe(false);
  });

  it("finds a shared file only by a well-formed id", () => {
    expect(sharedFile(root, "../../etc/passwd")).toBeNull();
    expect(sharedFile(root, "media-nothinghere")).toBeNull();
    expect(existsSync(join(root, ".devstation"))).toBe(false);
  });

  it("knows what a file is from its name", () => {
    expect(mediaType("a.MP3")).toEqual({ kind: "audio", type: "audio/mpeg" });
    expect(mediaType("doc.pdf").kind).toBe("pdf");
    expect(mediaType("logo.png").kind).toBe("image");
    expect(mediaType("app.exe")).toEqual({ kind: "file", type: "application/octet-stream" });
  });
});

describe("byte ranges", () => {
  it("reads a Range header against the file's size", () => {
    expect(byteRange(null, 100)).toBeNull();
    expect(byteRange("bytes=0-", 100)).toEqual({ start: 0, end: 99 });
    expect(byteRange("bytes=10-19", 100)).toEqual({ start: 10, end: 19 });
    expect(byteRange("bytes=90-500", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
    expect(byteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(byteRange("bytes=0-1,5-6", 100)).toBeNull();
  });

  it("keeps every answer the site gives within one chunk", () => {
    expect(mediaRange(null)).toBe(`bytes=0-${MEDIA_CHUNK - 1}`);
    expect(mediaRange("bytes=0-")).toBe(`bytes=0-${MEDIA_CHUNK - 1}`);
    expect(mediaRange("bytes=0-1")).toBe("bytes=0-1");
    expect(mediaRange(`bytes=5-${MEDIA_CHUNK * 3}`)).toBe(`bytes=5-${MEDIA_CHUNK + 4}`);
    expect(mediaRange("bytes=-500")).toBeNull();
    expect(mediaRange("bytes=9-3")).toBeNull();
  });

  it("splits a download into chunks that cover the file exactly", () => {
    const size = MEDIA_CHUNK * 2 + 10;
    expect(downloadRanges(size)).toEqual([
      `bytes=0-${MEDIA_CHUNK - 1}`,
      `bytes=${MEDIA_CHUNK}-${MEDIA_CHUNK * 2 - 1}`,
      `bytes=${MEDIA_CHUNK * 2}-${size - 1}`,
    ]);
  });
});
