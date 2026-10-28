import { afterEach, describe, expect, it } from "bun:test";
import { Route } from "@/routes/api.health";

type Handler = (ctx: { request: Request }) => Promise<Response>;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const get = (headers: Record<string, string> = {}) =>
  handlers.GET({ request: new Request("https://x.test/api/health", { headers }) });

afterEach(() => {
  delete process.env.HEALTH_TOKEN;
});

describe("/api/health", () => {
  it("tells the public only whether the deployment is ready", async () => {
    const body = (await (await get()).json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["ok"]);
  });

  it("shows each check to a caller holding HEALTH_TOKEN, and to no one else", async () => {
    process.env.HEALTH_TOKEN = "h".repeat(32);
    const wrong = (await (await get({ authorization: "Bearer nope" })).json()) as object;
    expect(Object.keys(wrong)).toEqual(["ok"]);
    const right = (await (await get({ authorization: `Bearer ${"h".repeat(32)}` })).json()) as {
      checks?: unknown[];
    };
    expect(Array.isArray(right.checks)).toBe(true);
  });
});
