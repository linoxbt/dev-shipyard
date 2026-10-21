import { describe, expect, it } from "bun:test";
import { openSession, safeReturnPath, sealSession } from "./github-oauth.server";

process.env.SESSION_SECRET ??= "test-secret-for-sessions-0123456789";

describe("coming back after GitHub sign-in", () => {
  it("returns to a page on this site", () => {
    expect(safeReturnPath("/launchkit/coding-agent")).toBe("/launchkit/coding-agent");
    expect(safeReturnPath("/launchkit/apps?tab=1")).toBe("/launchkit/apps?tab=1");
  });

  it("never to another site", () => {
    expect(safeReturnPath("https://evil.example")).toBeNull();
    expect(safeReturnPath("//evil.example/x")).toBeNull();
    expect(safeReturnPath("/\\evil.example")).toBeNull();
    expect(safeReturnPath("/a b")).toBeNull();
    expect(safeReturnPath("")).toBeNull();
    expect(safeReturnPath(null)).toBeNull();
  });
});

describe("the session cookie", () => {
  it("round-trips and never contains the token in readable form", () => {
    const sealed = sealSession("gho_secretTOKEN123");
    expect(openSession(sealed)).toBe("gho_secretTOKEN123");
    const decoded = sealed
      .split(".")
      .map((p) => Buffer.from(p, "base64url").toString("latin1"))
      .join("");
    expect(sealed.includes("gho_")).toBe(false);
    expect(decoded.includes("gho_secretTOKEN123")).toBe(false);
  });

  it("refuses a tampered or old-format cookie", () => {
    const sealed = sealSession("gho_x");
    const parts = sealed.split(".");
    const body = Buffer.from(parts[2], "base64url");
    body[0] ^= 1;
    expect(openSession(`${parts[0]}.${parts[1]}.${body.toString("base64url")}`)).toBeNull();
    const legacy = Buffer.from(JSON.stringify({ token: "gho_x", exp: Date.now() + 1e6 })).toString(
      "base64url",
    );
    expect(openSession(`${legacy}.anymac`)).toBeNull();
  });
});
