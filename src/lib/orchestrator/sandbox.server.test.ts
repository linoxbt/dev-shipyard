import { describe, expect, it } from "bun:test";
import { routeOf, sandboxHostEnabled, sandboxRunner, splitId } from "./sandbox.server";

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

describe("routeOf", () => {
  const id = encodeURIComponent("ds-0123456789abcdef~ws-abc123");
  it("routes a screenshot, an action and the bare workspace", () => {
    expect(routeOf(`/agent/workspaces/${id}/shot/shot-mvw42o5u-1`)).toEqual({
      ids: { name: "ds-0123456789abcdef", inner: "ws-abc123" },
      action: "/shot",
      tail: "/shot-mvw42o5u-1",
    });
    expect(routeOf(`/agent/workspaces/${id}/messages`)?.action).toBe("/messages");
    expect(routeOf(`/agent/workspaces/${id}`)?.action).toBe("");
  });
  it("refuses anything else", () => {
    expect(routeOf(`/agent/workspaces/${id}/messages/shot-a-1`)).toBeNull();
    expect(routeOf(`/agent/workspaces/${id}/shot/../../etc`)).toBeNull();
    expect(routeOf(`/agent/workspaces/not-a-sandbox/files`)).toBeNull();
    expect(routeOf(`/agent/workspaces/%E0%A4%A`)).toBeNull();
  });
});
