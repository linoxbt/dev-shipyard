import { describe, expect, it } from "bun:test";
import { deletionsToPropose } from "@/routes/api.workspace";

describe("deletionsToPropose", () => {
  it("keeps real deletions and drops paths the workspace never holds", () => {
    expect(
      deletionsToPropose([
        "src/old.ts",
        ".mcp.json",
        ".devstation/mcp.json",
        ".git/config",
        "node_modules/x/index.js",
        "dist/app.js",
        ".npmrc",
        ".aws/credentials",
        "docs/gone.md",
      ]),
    ).toEqual(["src/old.ts", "docs/gone.md"]);
  });
});

describe("/api/workspace model and mode", () => {
  it("refuses a model that is not on offer before anything else happens", async () => {
    const { Route } = await import("@/routes/api.workspace");
    const post = (
      Route.options as unknown as {
        server: { handlers: { POST: (c: { request: Request }) => Promise<Response> } };
      }
    ).server.handlers.POST;
    const send = (body: unknown) =>
      post({
        request: new Request("https://x.test/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
    const bad = await send({ action: "message", id: "w1", prompt: "hi", model: "gpt-9-imaginary" });
    expect(bad.status).toBe(400);
    const badMode = await send({ action: "message", id: "w1", prompt: "hi", mode: "yolo" });
    expect(badMode.status).toBe(400);
    // A model on the list gets past validation (and stops at the missing grant).
    const ok = await send({
      action: "message",
      id: "w1",
      prompt: "hi",
      model: "opus-5.5",
      mode: "plan",
    });
    expect(ok.status).not.toBe(400);
  });
});
