import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "./providers";
import { Orchestrator } from "./orchestrator";
import { Workspace } from "./workspace";
import { McpHub } from "./mcp";

const SERVER = join(import.meta.dir, "fixtures", "mcp-echo-server.ts");
const dirs: string[] = [];
const hubs: McpHub[] = [];
function ws() {
  const d = mkdtempSync(join(tmpdir(), "mcploop-"));
  dirs.push(d);
  return new Workspace(d);
}
afterEach(() => {
  for (const h of hubs.splice(0)) h.stop();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// MCP tools reaching the model, and their results coming back labelled. The
// server is spawned for real; only the model is scripted.

describe("mcp tools inside the loop", () => {
  it("offers them to the model and calls them", async () => {
    const hub = await McpHub.start({
      mcpServers: { fake: { command: "bun", args: ["run", SERVER] } },
    });
    hubs.push(hub);
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "fake__echo", input: { text: "from the server" } }] },
      { text: "got it" },
    ]);
    await new Orchestrator({ provider, workspace: ws(), mcp: hub }).run("use the tool");

    const offered = (provider.calls[0].tools ?? []).map((t) => t.name);
    expect(offered).toContain("fake__echo");
    expect(offered).toContain("read_file");
    const result = provider.calls[1].messages.find((m) => m.role === "tool") as { content: string };
    expect(result.content).toContain("from the server");
    expect(result.content).toContain("untrusted");
  }, 30000);

  it("reports a failing mcp tool as a failure", async () => {
    const hub = await McpHub.start({
      mcpServers: { fake: { command: "bun", args: ["run", SERVER] } },
    });
    hubs.push(hub);
    const provider = new MockProvider([
      { toolCalls: [{ id: "1", name: "fake__explode", input: {} }] },
      { text: "ok" },
    ]);
    await new Orchestrator({ provider, workspace: ws(), mcp: hub }).run("break it");
    const result = provider.calls[1].messages.find((m) => m.role === "tool") as {
      content: string;
      isError?: boolean;
    };
    expect(result.isError).toBe(true);
    expect(result.content).toContain("exploded");
  }, 30000);

  it("offers only the built-ins when no servers are configured", async () => {
    const provider = new MockProvider([{ text: "hi" }]);
    await new Orchestrator({ provider, workspace: ws() }).run("nothing");
    expect((provider.calls[0].tools ?? []).every((t) => !t.name.includes("__"))).toBe(true);
  }, 30000);
});
