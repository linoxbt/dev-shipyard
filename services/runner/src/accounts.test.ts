import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountsStore, MAX_ATTEMPTS, normaliseEmail } from "./accounts";
import { codeMessage, sendMail } from "./mail";

const ALICE = "0x1111111111111111111111111111111111111111";
const BOB = "0x2222222222222222222222222222222222222222";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "accounts-"));
  dirs.push(dir);
  return join(dir, "state", "accounts.json");
}

const store = (now = () => 1_000_000) => new AccountsStore(null, "test-secret", now);

describe("one GitHub account per wallet", () => {
  it("links, and keeps a second account off the same wallet", () => {
    const s = store();
    expect(s.linkGithub(ALICE, { id: 7, login: "alice" }).ok).toBe(true);
    expect(s.view(ALICE).github).toMatchObject({ id: 7, login: "alice" });
    const second = s.linkGithub(ALICE, { id: 8, login: "alice-alt" });
    expect(second).toMatchObject({ ok: false, error: "wallet_linked" });
    if (!second.ok) expect(second.message).toContain("@alice");
  });

  it("keeps one GitHub account off a second wallet", () => {
    const s = store();
    s.linkGithub(ALICE, { id: 7, login: "alice" });
    expect(s.linkGithub(BOB, { id: 7, login: "alice" })).toMatchObject({
      ok: false,
      error: "github_linked",
    });
    expect(s.view(BOB).github).toBeNull();
  });

  it("treats reconnecting the same account as success, keeping the first date", () => {
    let now = 1_000;
    const s = store(() => now);
    s.linkGithub(ALICE, { id: 7, login: "alice" });
    now += 5_000;
    expect(s.linkGithub(ALICE, { id: 7, login: "alice-renamed" }).ok).toBe(true);
    expect(s.view(ALICE).github).toMatchObject({ login: "alice-renamed", linkedAt: 1_000 });
  });

  it("frees the account when unlinked, and answers what a push is checked against", () => {
    const s = store();
    s.linkGithub(ALICE, { id: 7, login: "alice" });
    expect(s.githubMatches(ALICE, 7)).toBe(true);
    expect(s.githubMatches(BOB, 7)).toBe(false);
    expect(s.githubMatches(ALICE, 9)).toBe(false);
    s.unlinkGithub(ALICE);
    expect(s.view(ALICE).github).toBeNull();
    expect(s.linkGithub(BOB, { id: 7, login: "alice" }).ok).toBe(true);
  });
});

describe("proving an email address", () => {
  it("sends a code, verifies it, and records the address", () => {
    let now = 1_000;
    const s = store(() => now);
    const started = s.startEmail(ALICE, "  Me@Example.COM ");
    if (!started.ok) throw new Error(started.error);
    expect(started.address).toBe("me@example.com");
    expect(started.code).toMatch(/^\d{6}$/);
    expect(s.view(ALICE)).toMatchObject({ pendingEmail: "me@example.com", email: null });
    now += 1_000;
    const done = s.verifyEmail(ALICE, started.code);
    expect(done.ok).toBe(true);
    expect(s.view(ALICE).email).toMatchObject({ address: "me@example.com", verifiedAt: 2_000 });
    expect(s.view(ALICE).pendingEmail).toBeNull();
  });

  it("refuses a bad address, and one another wallet has verified", () => {
    const s = store();
    expect(s.startEmail(ALICE, "not-an-email")).toMatchObject({ error: "invalid_email" });
    const started = s.startEmail(ALICE, "shared@example.com");
    if (!started.ok) throw new Error(started.error);
    s.verifyEmail(ALICE, started.code);
    expect(s.startEmail(BOB, "SHARED@example.com")).toMatchObject({ error: "email_taken" });
  });

  it("counts wrong tries, then stops taking them", () => {
    const s = store();
    const started = s.startEmail(ALICE, "me@example.com");
    if (!started.ok) throw new Error(started.error);
    const wrong = started.code === "000000" ? "111111" : "000000";
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      expect(s.verifyEmail(ALICE, wrong)).toMatchObject({ error: "wrong_code" });
    }
    expect(s.verifyEmail(ALICE, wrong)).toMatchObject({ error: "wrong_code", left: 0 });
    // The challenge is spent: even the right code is no longer accepted.
    expect(s.verifyEmail(ALICE, started.code)).toMatchObject({ error: "too_many" });
    expect(s.view(ALICE).email).toBeNull();
  });

  it("expires a code, and holds off a resend for a minute", () => {
    let now = 1_000;
    const s = store(() => now);
    const first = s.startEmail(ALICE, "me@example.com");
    if (!first.ok) throw new Error(first.error);
    expect(s.startEmail(ALICE, "me@example.com")).toMatchObject({ error: "cooldown" });
    now += 61_000;
    expect(s.startEmail(ALICE, "me@example.com").ok).toBe(true);
    now += 10 * 60_000;
    expect(s.verifyEmail(ALICE, first.code)).toMatchObject({ error: "expired" });
    expect(s.verifyEmail(ALICE, "123456")).toMatchObject({ error: "no_pending" });
  });

  it("removes a verified address without touching the GitHub link", () => {
    const s = store();
    s.linkGithub(ALICE, { id: 7, login: "alice" });
    const started = s.startEmail(ALICE, "me@example.com");
    if (!started.ok) throw new Error(started.error);
    s.verifyEmail(ALICE, started.code);
    const after = s.unlinkEmail(ALICE);
    expect(after.email).toBeNull();
    expect(after.github).toMatchObject({ login: "alice" });
  });
});

describe("what is written down", () => {
  it("keeps links across a restart and never stores a usable code", () => {
    const file = tempFile();
    const first = new AccountsStore(file, "test-secret");
    first.linkGithub(ALICE, { id: 7, login: "alice" });
    const started = first.startEmail(ALICE, "me@example.com");
    if (!started.ok) throw new Error(started.error);

    const onDisk = readFileSync(file, "utf8");
    expect(onDisk).not.toContain(started.code);
    expect(onDisk).toContain("me@example.com");

    const reopened = new AccountsStore(file, "test-secret");
    expect(reopened.view(ALICE).github).toMatchObject({ id: 7 });
    // The challenge survives too, so a code sent before a restart still works.
    expect(reopened.verifyEmail(ALICE, started.code).ok).toBe(true);
  });

  it("starts empty when the file is nonsense", () => {
    const file = tempFile();
    const s = new AccountsStore(file, "test-secret");
    s.linkGithub(ALICE, { id: 7, login: "alice" });
    writeFileSync(file, "{ not json");
    expect(new AccountsStore(file, "test-secret").view(ALICE).github).toBeNull();
  });
});

describe("sending the code", () => {
  it("says plainly when no mail service is set up", async () => {
    const result = await sendMail({ to: "me@example.com", subject: "x", text: "y" }, {});
    expect(result).toMatchObject({ ok: false, reason: "not_configured" });
  });

  it("posts the code to Resend, from the configured sender", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: "1" }), { status: 200 });
    }) as unknown as typeof fetch;
    const { subject, text, html: body } = codeMessage("481920");
    const result = await sendMail(
      { to: "me@example.com", subject, text, html: body },
      { RESEND_API_KEY: "re_test", MAIL_FROM: "DevStation <noreply@devstation.online>" },
      fake,
    );
    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    const sent = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>;
    expect(sent).toMatchObject({
      from: "DevStation <noreply@devstation.online>",
      to: ["me@example.com"],
    });
    expect(String(sent.subject)).toContain("481920");
    expect(String(sent.text)).toContain("expires in 10 minutes");
    // Both parts go out: HTML for people, text for clients that refuse it.
    const html = String(sent.html);
    expect(html).toContain("481920");
    expect(html).toContain("https://devstation.online/icon-192.png");
    // The wordmark is live text, so the brand survives blocked images.
    expect(html).toContain("Station</span>");
    // Email is not a browser: nothing external can load or run.
    expect(html).not.toContain("<script");
    expect(html).not.toContain("stylesheet");
  });

  it("reports why a send failed, without inventing success", async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ message: "domain is not verified" }), {
        status: 403,
      })) as unknown as typeof fetch;
    expect(
      await sendMail(
        { to: "me@example.com", subject: "x", text: "y" },
        { RESEND_API_KEY: "k" },
        fake,
      ),
    ).toMatchObject({ ok: false, reason: "failed", message: "domain is not verified" });
  });
});

describe("normalising", () => {
  it("trims and lowercases", () => {
    expect(normaliseEmail("  Me@Example.COM ")).toBe("me@example.com");
  });
});
