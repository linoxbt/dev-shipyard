import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Talking to MCP servers.
//
// This is what "use an SDK or an API" means in practice most of the time: not
// writing an HTTP client from memory, but attaching to the server somebody has
// already written for that service and calling its tools. A Postgres server, a
// Sentry server, a company's internal one.
//
// Deliberately a small client rather than a dependency. The protocol surface
// the agent needs is three calls: initialize, tools/list, tools/call. The SDK
// brings a transport abstraction, a schema layer and its own dependency tree
// for that, and this has to run inside a compiled single-file binary.
//
// Two things shape the design. Tool names are namespaced per server, because
// two servers both offering "query" would otherwise silently shadow each other.
// And everything a server returns is untrusted content: an MCP server is
// somebody else's process, its output is not instructions, and it is labelled
// on the way back like any other outside text.

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  /** Skip this one without removing it from the file. */
  disabled?: boolean;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTool {
  /** `server__tool`, which is what the model sees. */
  name: string;
  server: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Where configuration is looked for, nearest first. A project's own servers
 *  should win over the ones set up globally. */
export function configPaths(root: string, home = process.env.HOME ?? ""): string[] {
  return [
    join(root, ".devstation", "mcp.json"),
    join(root, ".mcp.json"),
    ...(home ? [join(home, ".devstation", "mcp.json")] : []),
  ];
}

export function loadConfig(root: string, home = process.env.HOME ?? ""): McpConfig {
  const merged: McpConfig = { mcpServers: {} };
  // Read furthest-first so nearer files overwrite: the project has the last
  // word about its own servers.
  for (const path of configPaths(root, home).reverse()) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<McpConfig>;
      for (const [name, server] of Object.entries(parsed.mcpServers ?? {})) {
        if (server && typeof server.command === "string") merged.mcpServers[name] = server;
      }
    } catch {
      // A malformed config disables that file rather than the whole agent.
      // Reported by `devstation mcp`, which is where somebody would look.
    }
  }
  return merged;
}

export const SEPARATOR = "__";

export function qualify(server: string, tool: string): string {
  return `${server}${SEPARATOR}${tool}`;
}

export function split(qualified: string): { server: string; tool: string } | null {
  const at = qualified.indexOf(SEPARATOR);
  if (at <= 0) return null;
  return { server: qualified.slice(0, at), tool: qualified.slice(at + SEPARATOR.length) };
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CALL_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 20_000;

/**
 * One server, over stdio.
 *
 * JSON-RPC framed by newlines. Partial lines are buffered, because a server
 * writing a large tool result will not deliver it in one chunk and treating
 * each chunk as a message is how this breaks only on the responses that
 * matter.
 */
export class McpServer {
  private child: ChildProcess | null = null;
  private buffer = "";
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private startError: string | null = null;

  constructor(
    readonly name: string,
    private readonly config: McpServerConfig,
  ) {}

  get failed(): string | null {
    return this.startError;
  }

  async start(): Promise<boolean> {
    try {
      this.child = spawn(this.config.command, this.config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.config.env },
      });
    } catch (error) {
      this.startError = error instanceof Error ? error.message : String(error);
      return false;
    }

    this.child.on("error", (error) => {
      this.startError = error.message;
      this.failAll(error);
    });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk.toString("utf8")));
    // A server's stderr is its own logging. It is not read as protocol, and it
    // is not shown, because a chatty server would drown the transcript.
    this.child.stderr?.resume();
    this.child.on("exit", () => this.failAll(new Error(`${this.name} exited`)));

    try {
      await this.request(
        "initialize",
        {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "devstation", version: "0.1.0" },
        },
        START_TIMEOUT_MS,
      );
      this.notify("notifications/initialized", {});
      return true;
    } catch (error) {
      this.startError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  private onData(text: string) {
    this.buffer += text;
    // Only complete lines are messages. The remainder stays for the next chunk.
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf("\n");
      if (!line) continue;
      try {
        this.onMessage(JSON.parse(line) as Record<string, unknown>);
      } catch {
        // Not JSON, so not for us. Servers do print the occasional stray line.
      }
    }
  }

  private onMessage(message: Record<string, unknown>) {
    const id = message.id;
    if (typeof id !== "number") return; // a notification, which we do not use
    const waiting = this.pending.get(id);
    if (!waiting) return;
    this.pending.delete(id);
    clearTimeout(waiting.timer);

    const error = message.error as { message?: string } | undefined;
    if (error) waiting.reject(new Error(error.message ?? "the server returned an error"));
    else waiting.resolve(message.result);
  }

  private failAll(error: Error) {
    for (const [, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(error);
    }
    this.pending.clear();
  }

  private send(payload: Record<string, unknown>) {
    this.child?.stdin?.write(`${JSON.stringify(payload)}\n`);
  }

  private notify(method: string, params: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method: string, params: unknown, timeoutMs = CALL_TIMEOUT_MS): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${this.name} did not answer ${method} within ${timeoutMs / 1000}s`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async listTools(): Promise<McpTool[]> {
    const result = (await this.request("tools/list", {})) as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    };
    return (result.tools ?? []).map((tool) => ({
      name: qualify(this.name, tool.name),
      server: this.name,
      toolName: tool.name,
      description: tool.description ?? `${tool.name} on ${this.name}`,
      inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  async callTool(tool: string, args: Record<string, unknown>): Promise<string> {
    const result = (await this.request("tools/call", { name: tool, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    const text = (result.content ?? [])
      .map((part) => (part.type === "text" ? (part.text ?? "") : `[${part.type}]`))
      .join("\n")
      .trim();
    if (result.isError) throw new Error(text || "the tool reported an error");
    return text || "(the tool returned nothing)";
  }

  stop() {
    this.failAll(new Error("stopped"));
    this.child?.kill();
    this.child = null;
  }
}

export interface McpStatus {
  server: string;
  ok: boolean;
  tools: number;
  error?: string;
}

/** Every configured server, started, with their tools gathered. */
export class McpHub {
  private readonly servers = new Map<string, McpServer>();
  private readonly byTool = new Map<string, McpTool>();
  readonly status: McpStatus[] = [];

  static async start(config: McpConfig): Promise<McpHub> {
    const hub = new McpHub();
    const entries = Object.entries(config.mcpServers).filter(([, s]) => !s.disabled);

    // In parallel: a slow server should not hold up the others, and the whole
    // point is that starting these is not something anybody should wait on.
    await Promise.all(
      entries.map(async ([name, serverConfig]) => {
        const server = new McpServer(name, serverConfig);
        const started = await server.start();
        if (!started) {
          hub.status.push({
            server: name,
            ok: false,
            tools: 0,
            error: server.failed ?? "did not start",
          });
          server.stop();
          return;
        }
        try {
          const tools = await server.listTools();
          for (const tool of tools) hub.byTool.set(tool.name, tool);
          hub.servers.set(name, server);
          hub.status.push({ server: name, ok: true, tools: tools.length });
        } catch (error) {
          hub.status.push({
            server: name,
            ok: false,
            tools: 0,
            error: error instanceof Error ? error.message : String(error),
          });
          server.stop();
        }
      }),
    );
    return hub;
  }

  get tools(): McpTool[] {
    return [...this.byTool.values()];
  }

  has(name: string): boolean {
    return this.byTool.has(name);
  }

  async call(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.byTool.get(name);
    if (!tool) throw new Error(`There is no MCP tool called ${name}.`);
    const server = this.servers.get(tool.server);
    if (!server) throw new Error(`${tool.server} is not running.`);
    return server.callTool(tool.toolName, args);
  }

  stop() {
    for (const server of this.servers.values()) server.stop();
    this.servers.clear();
    this.byTool.clear();
  }
}
