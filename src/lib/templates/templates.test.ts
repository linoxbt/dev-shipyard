import { describe, expect, it } from "bun:test";
import {
  decodeBody,
  encodeBody,
  hasApp,
  isPrivatePath,
  parseRef,
  snapshotOf,
} from "./templates.server";

describe("community templates", () => {
  it("copies an app's files and build, never its secrets, notes or chat", () => {
    const snap = snapshotOf({
      files: {
        "index.html": "<h1>Hi</h1>",
        "src/app.ts": "x",
        ".env": "KEY=1",
        ".env.local": "KEY=2",
        "web/.env.production": "KEY=3",
        ".devstation/memory.md": "notes",
        "attachments/photo.png": "…",
        "node_modules/x/index.js": "x",
        "../escape": "no",
        "/abs": "no",
        "bad.txt": 42,
      },
      dist: { "index.html": "<h1>Built</h1>" },
      history: [{ role: "user", content: "my secret plan" }],
      turns: [{ prompt: "private" }],
    });
    expect(Object.keys(snap.files).sort()).toEqual(["index.html", "src/app.ts"]);
    expect(snap.dist).toEqual({ "index.html": "<h1>Built</h1>" });
    expect(JSON.stringify(snap)).not.toContain("secret plan");
    expect(hasApp(snap)).toBe(true);
    expect(hasApp(snapshotOf({ files: {} }))).toBe(false);
    expect(snapshotOf({ files: { "a.html": "x" }, dist: {} }).dist).toBeNull();
  });

  it("keeps ordinary dotfiles that are part of the app", () => {
    expect(isPrivatePath(".gitignore")).toBe(false);
    expect(isPrivatePath("src/environment.ts")).toBe(false);
    expect(isPrivatePath(".env.example")).toBe(true);
  });

  it("round-trips a body the way projects are stored", () => {
    const value = { files: { "index.html": "é".repeat(1000) }, dist: null };
    const body = encodeBody(value);
    expect(body.length).toBeLessThan(200);
    expect(decodeBody(body)).toEqual(value);
    expect(decodeBody("not gzip")).toBeNull();
  });

  it("names a project by account and id", () => {
    const owner = `0x${"A".repeat(40)}`;
    expect(parseRef(`${owner}:proj_1`)).toEqual({ owner: owner.toLowerCase(), id: "proj_1" });
    expect(parseRef("0x1:proj")).toBeNull();
    expect(parseRef(`${owner}:../x`)).toBeNull();
  });
});
