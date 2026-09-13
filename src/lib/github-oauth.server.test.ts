import { describe, expect, it } from "bun:test";
import { safeReturnPath } from "./github-oauth.server";

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
