import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint } from "./git";
import { initLocalRepo } from "./repo-session";

// The deployer wallet, screenshots and attachments live in the project folder
// but must never be committed: a push of the history would publish the key.

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tracked = (root: string) =>
  execFileSync("git", ["ls-files"], { cwd: root }).toString().trim().split("\n").filter(Boolean);

describe("DevStation's own files", () => {
  it("are never committed, by the first commit or a checkpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "ctl-"));
    dirs.push(root);
    mkdirSync(join(root, ".devstation", "shots"), { recursive: true });
    writeFileSync(join(root, ".devstation", "wallet.json"), '{"privateKey":"0xabc"}');
    writeFileSync(join(root, "index.html"), "<h1>x</h1>");
    expect(await initLocalRepo(root, "start")).toBe(true);
    expect(tracked(root)).toEqual(["index.html"]);

    writeFileSync(join(root, ".devstation", "shots", "shot-a-1.jpg"), "jpeg");
    mkdirSync(join(root, "attachments"));
    writeFileSync(join(root, "attachments", "pic.jpg"), "jpeg");
    writeFileSync(join(root, "app.js"), "1");
    await checkpoint(root, "work");
    expect(tracked(root).sort()).toEqual(["app.js", "index.html"]);
  });
});
