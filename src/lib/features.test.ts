import { describe, expect, it } from "bun:test";
import { switchedOff } from "./features";

describe("switchedOff", () => {
  it("serves the agent at / and nowhere else", () => {
    expect(switchedOff("/", true)).toBe(false);
    expect(switchedOff("/launchkit/coding-agent", true)).toBe(true);
  });

  it("switches off every other page: not found, not forwarded", () => {
    for (const p of [
      "/overview",
      "/explorer/mainnet",
      "/launchkit/marketplace",
      "/settings",
      "/docs",
      "/docs/labels",
    ]) {
      expect(switchedOff(p, true)).toBe(true);
    }
  });

  it("keeps the agent's docs, the CLI docs, the API and files", () => {
    for (const p of [
      "/docs/coding-agent",
      "/docs/cli",
      "/docs/cli/install",
      "/api/workspace",
      "/_serverFn/abc",
      "/install.sh",
      "/favicon.svg",
    ]) {
      expect(switchedOff(p, true)).toBe(false);
    }
  });

  it("switches nothing off when every feature is on", () => {
    expect(switchedOff("/overview", false)).toBe(false);
    expect(switchedOff("/launchkit/coding-agent", false)).toBe(false);
  });
});
