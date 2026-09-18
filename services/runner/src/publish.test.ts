import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// publish.ts reads PUBLISH_DIR at import time, so the directory is set before
// the module is loaded and the real /srv is never touched.
const dir = mkdtempSync(join(tmpdir(), "publish-"));
process.env.PUBLISH_DIR = dir;
const { firstFreeSlug, publishSite, slugStatus, suggestSlugs } = await import("./publish");

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const page = { "index.html": "<h1>hi</h1>" };

afterEach(() => {
  for (const slug of ["untitled-app", "untitled-app-2", "pay-link", "pay-link-2"]) {
    rmSync(join(dir, slug), { recursive: true, force: true });
  }
});

describe("whether an address can be had", () => {
  it("refuses names that cannot be a subdomain, and says why", () => {
    expect(slugStatus("admin", ALICE)).toMatchObject({ state: "unusable", reason: "reserved" });
    expect(slugStatus("docs", ALICE)).toMatchObject({ state: "unusable", reason: "reserved" });
    // The mail records live on these labels; an app there would never resolve.
    for (const label of ["send", "rsend", "resend"]) {
      expect(slugStatus(label, ALICE)).toMatchObject({ state: "unusable", reason: "reserved" });
    }
    expect(slugStatus("a", ALICE)).toMatchObject({ state: "unusable", reason: "invalid" });
    expect(slugStatus("42", ALICE)).toMatchObject({ state: "unusable", reason: "invalid" });
    expect(slugStatus("x".repeat(41), ALICE)).toMatchObject({ state: "unusable" });
  });

  it("tells a free address from your own and from somebody else's", () => {
    expect(slugStatus("Untitled App", ALICE)).toEqual({ slug: "untitled-app", state: "free" });
    expect(publishSite({ slug: "Untitled app", files: page, owner: ALICE }).ok).toBe(true);
    expect(slugStatus("untitled-app", ALICE)).toMatchObject({
      slug: "untitled-app",
      state: "yours",
    });
    expect(slugStatus("untitled-app", BOB)).toMatchObject({ slug: "untitled-app", state: "taken" });
  });

  it("suggests addresses that are themselves free and usable", () => {
    publishSite({ slug: "pay-link", files: page, owner: ALICE });
    const suggestions = suggestSlugs("pay-link", BOB);
    expect(suggestions.length).toBe(3);
    expect(suggestions).not.toContain("pay-link");
    // One of them carries the wallet, so a popular name is not just a queue.
    expect(suggestions).toContain(`pay-link-${BOB.slice(2, 6)}`);
    for (const s of suggestions) expect(slugStatus(s, BOB)).toMatchObject({ state: "free" });
    expect(firstFreeSlug("pay-link", BOB)).toBe("pay-link-2");
    // Their own address is not something to route around.
    expect(firstFreeSlug("pay-link", ALICE)).toBe("pay-link");
    expect(suggestSlugs("admin", BOB)[0]).toBe("admin-2");
  });
});

describe("publishing when the address is taken", () => {
  it("still refuses by default, so nobody is moved without asking", () => {
    publishSite({ slug: "pay-link", files: page, owner: ALICE });
    expect(publishSite({ slug: "pay-link", files: page, owner: BOB })).toEqual({
      ok: false,
      message: "That name is taken by another wallet.",
    });
  });

  it("publishes at a free address when asked, and leaves the first app alone", () => {
    publishSite({ slug: "pay-link", files: page, owner: ALICE });
    const result = publishSite({
      slug: "pay-link",
      files: { "index.html": "<h1>bob</h1>" },
      owner: BOB,
      fallback: true,
    });
    expect(result).toMatchObject({
      ok: true,
      slug: "pay-link-2",
      url: "https://pay-link-2.devstation.online",
      renamedFrom: "pay-link",
    });
    expect(slugStatus("pay-link", ALICE).state).toBe("yours");
    expect(slugStatus("pay-link-2", BOB).state).toBe("yours");
  });

  it("replaces your own app without renaming it", () => {
    publishSite({ slug: "pay-link", files: page, owner: ALICE });
    const again = publishSite({ slug: "pay-link", files: page, owner: ALICE, fallback: true });
    expect(again).toMatchObject({ ok: true, slug: "pay-link" });
    expect(again.renamedFrom).toBeUndefined();
  });
});
