import { describe, expect, it, beforeEach } from "bun:test";
import {
  COOKIE_NAME,
  clearedCookie,
  createSession,
  endSession,
  passwordMatches,
  readCookie,
  resetSessions,
  sessionCookie,
  validSession,
} from "./session";

beforeEach(() => resetSessions());

describe("passwordMatches", () => {
  it("accepts the right password and rejects the rest", () => {
    expect(passwordMatches("hunter2", "hunter2")).toBe(true);
    expect(passwordMatches("hunter3", "hunter2")).toBe(false);
    expect(passwordMatches("hunter", "hunter2")).toBe(false);
    expect(passwordMatches("hunter22", "hunter2")).toBe(false);
  });

  it("refuses everything when no password is configured", () => {
    // An unset password must close the dashboard, not open it. This is the
    // difference between "off" and "public window into the machine".
    expect(passwordMatches("", "")).toBe(false);
    expect(passwordMatches("anything", "")).toBe(false);
  });

  it("does not throw on a length mismatch", () => {
    expect(() => passwordMatches("x".repeat(500), "short")).not.toThrow();
  });
});

describe("sessions", () => {
  it("accepts an issued session and nothing else", () => {
    const id = createSession();
    expect(validSession(id)).toBe(true);
    expect(validSession("made-up")).toBe(false);
    expect(validSession(undefined)).toBe(false);
  });

  it("issues unguessable, unique ids", () => {
    const a = createSession();
    const b = createSession();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(30);
  });

  it("forgets a session on sign out", () => {
    const id = createSession();
    endSession(id);
    expect(validSession(id)).toBe(false);
  });
});

describe("cookies", () => {
  it("reads one cookie out of a header", () => {
    expect(readCookie("a=1; devstation_dash=abc; b=2", COOKIE_NAME)).toBe("abc");
    expect(readCookie("a=1", COOKIE_NAME)).toBeUndefined();
    expect(readCookie(undefined, COOKIE_NAME)).toBeUndefined();
  });

  it("sets the flags that keep a session from leaking", () => {
    // httpOnly: script cannot read it. Secure: never crosses plain HTTP.
    // SameSite=Strict: another origin cannot ride it.
    const c = sessionCookie("abc");
    expect(c).toContain("HttpOnly");
    expect(c).toContain("Secure");
    expect(c).toContain("SameSite=Strict");
  });

  it("expires the cookie on sign out", () => {
    expect(clearedCookie()).toContain("Max-Age=0");
  });
});
