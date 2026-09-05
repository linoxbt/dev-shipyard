import { describe, expect, it } from "bun:test";
import { repoNameFrom } from "./github";

// GitHub rejects repo names with spaces, and a project name like "nova swap"
// is exactly what the App Builder produces from a prompt.
describe("repoNameFrom", () => {
  it("turns a prompt-derived project name into a valid repo name", () => {
    expect(repoNameFrom("nova swap")).toBe("nova-swap");
    expect(repoNameFrom("Tip Jar with a QIE amount input")).toBe("tip-jar-with-a-qie-amount-input");
  });

  it("strips characters GitHub will not accept", () => {
    expect(repoNameFrom("My App! (v2)")).toBe("my-app-v2");
    expect(repoNameFrom("  spaced  out  ")).toBe("spaced-out");
  });

  it("never returns a name that starts or ends with a separator", () => {
    for (const raw of ["--edge--", "...dots...", "-", "!!!"]) {
      const out = repoNameFrom(raw);
      expect(out.startsWith("-")).toBe(false);
      expect(out.endsWith("-")).toBe(false);
      expect(out.startsWith(".")).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("falls back rather than producing an empty name", () => {
    expect(repoNameFrom("")).toBe("devstation-app");
    expect(repoNameFrom("!!!")).toBe("devstation-app");
  });

  it("stays within GitHub's length limit", () => {
    expect(repoNameFrom("a".repeat(200)).length).toBeLessThanOrEqual(90);
  });
});

describe("OAuth session sealing", () => {
  it("rejects a tampered session cookie", async () => {
    const { sealSession, openSession } = await import("./github-oauth.server");
    process.env.GITHUB_SESSION_SECRET = "test-secret-for-sealing";
    const sealed = sealSession("gho_realtoken");
    expect(openSession(sealed)).toBe("gho_realtoken");

    // A forged cookie must not hand the server somebody else's token: this is
    // what authorises pushing code to a GitHub account.
    const [payload] = sealed.split(".");
    expect(openSession(`${payload}.forgedsignature`)).toBeNull();
    expect(openSession("garbage")).toBeNull();
    expect(openSession(undefined)).toBeNull();
  });

  it("refuses an expired session", async () => {
    const { openSession } = await import("./github-oauth.server");
    const { createHmac } = await import("node:crypto");
    process.env.GITHUB_SESSION_SECRET = "test-secret-for-sealing";
    const payload = Buffer.from(
      JSON.stringify({ token: "gho_x", exp: Date.now() - 1000 }),
    ).toString("base64url");
    const mac = createHmac("sha256", "test-secret-for-sealing").update(payload).digest("base64url");
    expect(openSession(`${payload}.${mac}`)).toBeNull();
  });

  it("only accepts a state value it issued", async () => {
    const { newState, stateValid } = await import("./github-oauth.server");
    process.env.GITHUB_SESSION_SECRET = "test-secret-for-sealing";
    expect(stateValid(newState())).toBe(true);
    // Without this an attacker could complete a login of their choosing in the
    // victim's browser and have the victim's apps pushed to their account.
    expect(stateValid("attacker-chosen.value")).toBe(false);
    expect(stateValid(undefined)).toBe(false);
  });

  it("parses cookies without tripping on = inside a value", async () => {
    const { readCookie } = await import("./github-oauth.server");
    expect(readCookie("a=1; devstation_gh=abc.def==; b=2", "devstation_gh")).toBe("abc.def==");
    expect(readCookie(null, "devstation_gh")).toBeUndefined();
  });
});
