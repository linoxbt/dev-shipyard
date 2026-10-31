import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { isConnectorId, openToken, sealToken } from "./connectors.server";
import { isAdmin } from "./request.server";
import { accountAddress } from "@/lib/auth/account.server";

const key = createHash("sha256").update("test").digest();

describe("connected accounts", () => {
  it("keeps tokens encrypted, and only the right key opens them", () => {
    const sealed = sealToken("ghp_secret_token_value", key);
    expect(sealed).not.toContain("ghp_secret_token_value");
    expect(openToken(sealed, key)).toBe("ghp_secret_token_value");
    expect(openToken(sealed, createHash("sha256").update("other").digest())).toBeNull();
    expect(openToken(`${sealed}x`, key)).toBeNull();
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
