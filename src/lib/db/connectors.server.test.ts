import { describe, expect, it } from "bun:test";
import { isConnectorId, openToken, sealToken } from "./connectors.server";
import { isAdmin } from "./request.server";
import { accountAddress } from "@/lib/auth/account.server";

describe("connected accounts", () => {
  it("keeps tokens encrypted, and only the right key opens them", () => {
    const env = { SESSION_SECRET: "test" };
    const sealed = sealToken("ghp_secret_token_value", env);
    expect(sealed).not.toContain("ghp_secret_token_value");
    expect(openToken(sealed, env)).toBe("ghp_secret_token_value");
    expect(openToken(sealed, { SESSION_SECRET: "other" })).toBeNull();
    expect(openToken(`${sealed}x`, env)).toBeNull();
  });

  it("seals with a key of its own once set, and still opens what came before", () => {
    const before = sealToken("old-token", { SESSION_SECRET: "s" });
    const env = { SESSION_SECRET: "s", CONNECTOR_KEY: "k1" };
    const after = sealToken("new-token", env);
    expect(after.startsWith("v2.")).toBe(true);
    expect(openToken(after, env)).toBe("new-token");
    expect(openToken(before, env)).toBe("old-token");
    // Rotating the session secret no longer touches what CONNECTOR_KEY sealed.
    expect(openToken(after, { SESSION_SECRET: "rotated", CONNECTOR_KEY: "k1" })).toBe("new-token");
    expect(openToken(after, { SESSION_SECRET: "s", CONNECTOR_KEY: "k2" })).toBeNull();
  });

  it("refuses a value with a shortened authentication tag", () => {
    const env = { SESSION_SECRET: "test" };
    const [iv, tag, body] = sealToken("secret", env).split(".");
    const short = [
      iv,
      Buffer.from(tag, "base64url").subarray(0, 4).toString("base64url"),
      body,
    ].join(".");
    expect(openToken(short, env)).toBeNull();
  });

  it("knows only the providers it supports", () => {
    for (const id of ["github", "vercel", "netlify", "railway", "supabase"]) {
      expect(isConnectorId(id)).toBe(true);
    }
    expect(isConnectorId("aws")).toBe(false);
  });
});

describe("admins", () => {
  it("are the accounts listed by email in ADMIN_EMAILS", () => {
    const env = { ADMIN_EMAILS: " Boss@Example.com , other@example.com" };
    expect(isAdmin(accountAddress("boss@example.com"), env)).toBe(true);
    expect(isAdmin(accountAddress("someone@example.com"), env)).toBe(false);
    expect(isAdmin(null, env)).toBe(false);
    expect(isAdmin(accountAddress("boss@example.com"), {})).toBe(false);
  });
});

describe("one launch credit per person", () => {
  it("treats plus-addressed and dotted Gmail variants as one person", async () => {
    const { personOf } = await import("./request.server");
    const env = { SESSION_SECRET: "s" };
    const a = personOf("ada.lovelace@gmail.com", env);
    expect(personOf("adalovelace+devstation@gmail.com", env)).toBe(a);
    expect(personOf("Ada.Love.lace@googlemail.com", env)).toBe(a);
    expect(personOf("ada.lovelace@example.com", env)).not.toBe(a);
    expect(personOf("ada.lovelace+1@example.com", env)).toBe(
      personOf("ada.lovelace@example.com", env),
    );
  });
});
