// An MCP server, for testing the client against something that actually
// speaks the protocol rather than a mock that agrees with whatever the
// client does. Spawned over stdio by mcp.test.ts.

const send = (m: unknown) => process.stdout.write(`${JSON.stringify(m)}\n`);
let buf = "";
process.stdin.on("data", (chunk: Buffer) => {
  buf += chunk.toString();
  let nl = buf.indexOf("\n");
  while (nl !== -1) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    nl = buf.indexOf("\n");
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "fake", version: "1" },
        },
      });
    } else if (msg.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo a message back.",
              inputSchema: {
                type: "object",
                properties: { text: { type: "string" } },
                required: ["text"],
              },
            },
            {
              name: "explode",
              description: "Always fails.",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      });
    } else if (msg.method === "tools/call") {
      if (msg.params.name === "explode") {
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { isError: true, content: [{ type: "text", text: "it exploded" }] },
        });
      } else if (msg.params.name === "echo") {
        // Deliberately large, to exercise chunked reads.
        const text = String(msg.params.arguments?.text ?? "");
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { content: [{ type: "text", text: text.repeat(1) }] },
        });
      } else {
        send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such tool" } });
      }
    }
  }
});
