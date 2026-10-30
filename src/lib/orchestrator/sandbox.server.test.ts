import { describe, expect, it } from "bun:test";
import { sandboxHostEnabled, sandboxRunner, splitId } from "./sandbox.server";

describe("the sandbox orchestrator", () => {
  it("is the default agent host, and AGENT_HOST=runner turns it off", () => {
    expect(sandboxHostEnabled({})).toBe(true);
    expect(sandboxHostEnabled({ AGENT_HOST: "runner" })).toBe(false);
  });

  it("splits an outside id into the sandbox and the server's own id", () => {
    expect(splitId("ds-0123456789abcdef~ws-4b40086f45884ecc55")).toEqual({
      name: "ds-0123456789abcdef",
      inner: "ws-4b40086f45884ecc55",
    });
    for (const bad of ["ws-123", "~ws-1", "ds-x~ws-1", "ds-0123456789abcdef~../x", "evil~ws-1"]) {
      expect(splitId(bad)).toBeNull();
    }
  });

  it("answers a malformed id as gone, without touching Vercel", async () => {
    const gone = await sandboxRunner("/agent/workspaces/not-a-sandbox-id", {}, "t");
    expect(gone.status).toBe(404);
  });
});
