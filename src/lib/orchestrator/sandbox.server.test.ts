import { afterEach, describe, expect, it } from "bun:test";
import { sandboxHostEnabled, sandboxRunner, splitId, tokenFor } from "./sandbox.server";

const saved = {
  SESSION_SECRET: process.env.SESSION_SECRET,
  RUNNER_TOKEN: process.env.RUNNER_TOKEN,
};
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

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

  it("gives every sandbox its own token, long enough for the server to accept", () => {
    const a = tokenFor("ds-aaaaaaaaaaaaaaaa", "k");
    expect(a).toHaveLength(64);
    expect(tokenFor("ds-bbbbbbbbbbbbbbbb", "k")).not.toBe(a);
    expect(tokenFor("ds-aaaaaaaaaaaaaaaa", "other")).not.toBe(a);
  });

  it("says what is missing rather than failing obscurely", async () => {
    delete process.env.SESSION_SECRET;
    delete process.env.RUNNER_TOKEN;
    const unset = await sandboxRunner("/agent/workspaces", { method: "POST" }, "t");
    expect(unset.status).toBe(503);
    expect(String(unset.body.message)).toContain("SESSION_SECRET");

    process.env.SESSION_SECRET = "s".repeat(40);
    const gone = await sandboxRunner("/agent/workspaces/not-a-sandbox-id", {}, "t");
    expect(gone.status).toBe(404);
  });
});
