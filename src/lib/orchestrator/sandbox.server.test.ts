import { describe, expect, it } from "bun:test";
import {
  ownerOfSandbox,
  routeOf,
  sandboxHostEnabled,
  sandboxRunner,
  splitId,
} from "./sandbox.server";

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
      search: "",
    });
    expect(routeOf(`/agent/workspaces/${id}/messages`)?.action).toBe("/messages");
    // A plain query goes through (publishing asks for every asset); an odd one does not.
    expect(routeOf(`/agent/workspaces/${id}/preview?all=1`)?.search).toBe("?all=1");
    expect(routeOf(`/agent/workspaces/${id}/preview?x=<b>`)?.search).toBe("");
    expect(routeOf(`/agent/workspaces/${id}`)?.action).toBe("");
    expect(routeOf(`/agent/workspaces/${id}/media/media-mvw42o5uab12`)).toMatchObject({
      action: "/media",
      tail: "/media-mvw42o5uab12",
    });
  });
  it("refuses anything else", () => {
    expect(routeOf(`/agent/workspaces/${id}/messages/shot-a-1`)).toBeNull();
    expect(routeOf(`/agent/workspaces/${id}/shot/../../etc`)).toBeNull();
    expect(routeOf(`/agent/workspaces/${id}/shot/media-mvw42o5uab12`)).toBeNull();
    expect(routeOf(`/agent/workspaces/${id}/media/shot-a-1`)).toBeNull();
    expect(routeOf(`/agent/workspaces/${id}/media/media-x`)).toBeNull();
    expect(routeOf(`/agent/workspaces/not-a-sandbox/files`)).toBeNull();
    expect(routeOf(`/agent/workspaces/%E0%A4%A`)).toBeNull();
  });
});

describe("ownerOfSandbox", () => {
  it("reads only an account id this site wrote, never anything else", () => {
    const id = `0x${"a".repeat(40)}`;
    expect(ownerOfSandbox({ app: "devstation", owner: id })).toBe(id);
    // A project made before owners were recorded: nobody is the owner, so
    // nobody's connected accounts go in.
    expect(ownerOfSandbox({ app: "devstation" })).toBeNull();
    expect(ownerOfSandbox(undefined)).toBeNull();
    expect(ownerOfSandbox({ owner: "someone" })).toBeNull();
  });
});

describe("recording the owner of a machine made before owners were", () => {
  const me = `0x${"a".repeat(40)}`;
  const machine = (createdAt: string) => {
    const updates: unknown[] = [];
    return {
      updates,
      sandbox: {
        createdAt: new Date(createdAt),
        tags: { app: "devstation" } as Record<string, string>,
        update: async (p: unknown) => void updates.push(p),
      },
    };
  };
  const members = (body: Record<string, unknown>) =>
    (async () => ({ ok: true, status: 200, body })) as never;

  it("records the sender when the machine is old, theirs, and nobody else builds there", async () => {
    const { adoptLegacyOwner } = await import("./sandbox.server");
    const m = machine("2026-11-02T18:31:00Z");
    const owner = await adoptLegacyOwner(
      m.sandbox as never,
      "https://x",
      "t",
      "ws-1",
      me,
      "c",
      members({ role: "owner", owner: me, collaborators: [] }),
    );
    expect(owner).toBe(me);
    expect(m.updates).toEqual([{ tags: { app: "devstation", owner: me } }]);
  });

  it("records nobody for a new machine, a shared one, or one that is not theirs", async () => {
    const { adoptLegacyOwner } = await import("./sandbox.server");
    const cases: [string, Record<string, unknown>][] = [
      ["2026-11-03T10:00:00Z", { role: "owner", owner: me, collaborators: [] }],
      ["2026-11-01T10:00:00Z", { role: "owner", owner: me, collaborators: ["0xbbb"] }],
      ["2026-11-01T10:00:00Z", { role: "builder", owner: "0xccc", collaborators: [me] }],
    ];
    for (const [at, body] of cases) {
      const m = machine(at);
      expect(
        await adoptLegacyOwner(
          m.sandbox as never,
          "https://x",
          "t",
          "ws-1",
          me,
          "c",
          members(body),
        ),
      ).toBeNull();
      expect(m.updates).toEqual([]);
    }
  });
});

describe("keeping a machine up", () => {
  it("extends only by the shortfall, never stacking hours of idle time", async () => {
    const { extensionNeeded } = await import("./sandbox.server");
    const now = 1_000_000_000;
    const at = (ms: number) => new Date(now + ms);
    const want = 45 * 60_000;
    // 40 minutes left: top up 5.
    expect(extensionNeeded(at(40 * 60_000), want, now)).toBe(5 * 60_000);
    // Already 45 or more left: nothing.
    expect(extensionNeeded(at(45 * 60_000), want, now)).toBe(0);
    expect(extensionNeeded(at(4 * 60 * 60_000), want, now)).toBe(0);
    // Under a minute short is not worth a call.
    expect(extensionNeeded(at(want - 30_000), want, now)).toBe(0);
    // No expiry known: the whole window.
    expect(extensionNeeded(undefined, want, now)).toBe(want);
  });
});
