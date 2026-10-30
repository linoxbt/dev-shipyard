import { describe, expect, it } from "bun:test";
import { agentOnlyRedirect } from "./features";

describe("agentOnlyRedirect", () => {
  it("opens the app at the agent, with no landing page in front", () => {
    expect(agentOnlyRedirect("/", true)).toBeNull();
  });

  it("sends every other page, and the agent's old address, to the agent at /", () => {
    for (const p of [
      "/launchkit/coding-agent",
      "/overview",
      "/explorer/mainnet",
      "/launchkit/marketplace",
      "/settings",
      "/docs",
      "/docs/labels",
    ]) {
      expect(agentOnlyRedirect(p, true)).toBe("/");
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
      expect(agentOnlyRedirect(p, true)).toBeNull();
    }
  });

  it("does nothing when the switch is off", () => {
    expect(agentOnlyRedirect("/overview", false)).toBeNull();
  });
});
