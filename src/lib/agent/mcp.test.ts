import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpHub, McpServer, configPaths, loadConfig, qualify, split } from "./mcp";

// The client is tested against a server that actually speaks the protocol over
// stdio, not against a mock of one. The framing is the part most likely to be
// wrong, and a mock would agree with whatever the client did.

/** A server that actually speaks the protocol. Spawned for real, because the
 *  framing is the part most likely to be wrong and a mock would agree with
 *  whatever the client did. */
const SERVER = join(import.meta.dir, "fixtures", "mcp-echo-server.ts");

const dirs: string[] = [];
const hubs: McpHub[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "mcp-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const hub of hubs.splice(0)) hub.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("naming a tool", () => {
  it("puts the server in front, so two servers cannot shadow each other", () => {
    expect(qualify("postgres", "query")).toBe("postgres__query");
    expect(split("postgres__query")).toEqual({ server: "postgres", tool: "query" });
  });

  it("keeps a tool name that itself contains the separator", () => {
    expect(split("sentry__get__issue")).toEqual({ server: "sentry", tool: "get__issue" });
  });

  it("returns null for something that is not qualified", () => {
    expect(split("query")).toBeNull();
    expect(split("__query")).toBeNull();
  });
});

describe("configuration", () => {
  it("looks in the project before the home directory", () => {
    const paths = configPaths("/srv/app", "/home/me");
    expect(paths[0]).toContain("/srv/app");
    expect(paths.at(-1)).toContain("/home/me");
  });

  it("lets a project override a server set up globally", () => {
    const home = scratch();
    const root = scratch();
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(
      join(home, ".devstation", "mcp.json"),
      JSON.stringify({ mcpServers: { db: { command: "global-db" }, other: { command: "keep" } } }),
    );
    mkdirSync(join(root, ".devstation"), { recursive: true });
    writeFileSync(
      join(root, ".devstation", "mcp.json"),
      JSON.stringify({ mcpServers: { db: { command: "project-db" } } }),
    );

    const config = loadConfig(root, home);
    expect(config.mcpServers.db.command).toBe("project-db");
    // And the global one that was not overridden survives.
    expect(config.mcpServers.other.command).toBe("keep");
  });

  it("ignores a malformed file rather than refusing to start", () => {
    const root = scratch();
    writeFileSync(join(root, ".mcp.json"), "{ not json");
    expect(loadConfig(root, "")).toEqual({ mcpServers: {} });
  });

  it("ignores an entry with no command", () => {
    const root = scratch();
    writeFileSync(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { bad: { args: [] } } }));
    expect(loadConfig(root, "").mcpServers.bad).toBeUndefined();
  });

  it("returns nothing when there is no config anywhere", () => {
    expect(loadConfig(scratch(), scratch())).toEqual({ mcpServers: {} });
  });
});

describe("talking to a real server", () => {
  const config = { command: "bun", args: ["run", SERVER] };

  it("starts, lists its tools, and namespaces them", async () => {
    const server = new McpServer("fake", config);
    expect(await server.start()).toBe(true);
    const tools = await server.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["fake__echo", "fake__explode"]);
    expect(tools[0].description).toContain("Echo");
    expect(tools[0].inputSchema).toHaveProperty("properties");
    server.stop();
  }, 30_000);

  it("calls a tool and gets its text back", async () => {
    const server = new McpServer("fake", config);
    await server.start();
    expect(await server.callTool("echo", { text: "hello from the server" })).toBe(
      "hello from the server",
    );
    server.stop();
  }, 30_000);

  it("reassembles a result that arrives in pieces", async () => {
    // The framing bug worth having a test for: a large result does not arrive
    // in one chunk, and treating each chunk as a message breaks exactly on the
    // responses big enough to matter.
    const server = new McpServer("fake", config);
    await server.start();
    const big = "x".repeat(200_000);
    expect(await server.callTool("echo", { text: big })).toHaveLength(200_000);
    server.stop();
  }, 30_000);

  it("turns a tool's own error into a failure, not a result", async () => {
    const server = new McpServer("fake", config);
    await server.start();
    await expect(server.callTool("explode", {})).rejects.toThrow("it exploded");
    server.stop();
  }, 30_000);

  it("reports a protocol error rather than hanging", async () => {
    const server = new McpServer("fake", config);
    await server.start();
    await expect(server.callTool("nonexistent", {})).rejects.toThrow("no such tool");
    server.stop();
  }, 30_000);

  it("says a server did not start instead of pretending it did", async () => {
    const server = new McpServer("broken", { command: "definitely-not-a-real-command-xyz" });
    expect(await server.start()).toBe(false);
    expect(server.failed).toBeTruthy();
    server.stop();
  }, 30_000);
});

describe("the hub", () => {
  it("gathers the tools of every server that started", async () => {
    const hub = await McpHub.start({
      mcpServers: { fake: { command: "bun", args: ["run", SERVER] } },
    });
    hubs.push(hub);
    expect(hub.tools.map((t) => t.name).sort()).toEqual(["fake__echo", "fake__explode"]);
    expect(hub.has("fake__echo")).toBe(true);
    expect(await hub.call("fake__echo", { text: "hi" })).toBe("hi");
  }, 30_000);

  it("carries on when one server is broken, and says which", async () => {
    // One misconfigured server should cost that server, not the session.
    const hub = await McpHub.start({
      mcpServers: {
        fake: { command: "bun", args: ["run", SERVER] },
        broken: { command: "definitely-not-a-real-command-xyz" },
      },
    });
    hubs.push(hub);
    expect(hub.tools.map((t) => t.server)).toEqual(["fake", "fake"]);
    const broken = hub.status.find((s) => s.server === "broken");
    expect(broken?.ok).toBe(false);
    expect(broken?.error).toBeTruthy();
  }, 30_000);

  it("skips a server that is disabled", async () => {
    const hub = await McpHub.start({
      mcpServers: { fake: { command: "bun", args: ["run", SERVER], disabled: true } },
    });
    hubs.push(hub);
    expect(hub.tools).toEqual([]);
    expect(hub.status).toEqual([]);
  }, 30_000);

  it("refuses a tool it does not have", async () => {
    const hub = await McpHub.start({ mcpServers: {} });
    hubs.push(hub);
    await expect(hub.call("nothing__here", {})).rejects.toThrow("no MCP tool");
  }, 30_000);
});
