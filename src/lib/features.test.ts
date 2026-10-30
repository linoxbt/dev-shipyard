import { describe, expect, it } from "bun:test";
import { AGENT_HOME, agentOnlyRedirect } from "./features";

describe("agentOnlyRedirect", () => {
  it("sends every other page to the Coding Agent", () => {
    for (const p of [
      "/",
      "/overview",
      "/explorer/mainnet",
      "/launchkit/marketplace",
      "/settings",
      "/docs",
      "/docs/labels",
    ]) {
      expect(agentOnlyRedirect(p, true)).toBe(AGENT_HOME);
    }
  });

  it("keeps the agent, its docs, the CLI docs, the API and files", () => {
    for (const p of [
      "/launchkit/coding-agent",
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
