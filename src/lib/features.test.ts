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
      "/cookies",
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

describe("the API in Coding-Agent-only mode", () => {
  it("serves the agent's routes and nothing else", async () => {
    const { apiServedInAgentOnly } = await import("./features");
    for (const path of [
      "/api/workspace",
      "/api/model",
      "/api/model/turn",
      "/api/plan",
      "/api/connectors",
      "/api/oauth/github",
      "/api/oauth/railway/callback",
      "/api/access/session",
      "/api/admin/stats",
      "/api/github/push",
      "/api/health",
      "/api/cron/sandboxes",
      "/",
      "/assets/app.js",
    ]) {
      expect(apiServedInAgentOnly(path, true)).toBe(true);
    }
    for (const path of [
      "/api/agent",
      "/api/ai",
      "/api/sponsor-topup",
      "/api/listings",
      "/api/repo-agent",
      "/_serverFn/abc",
    ]) {
      expect(apiServedInAgentOnly(path, true)).toBe(false);
    }
    expect(apiServedInAgentOnly("/api/agent", false)).toBe(true);
  });
});
