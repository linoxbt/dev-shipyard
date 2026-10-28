import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Route, deployFilePath, siteTokenFor } from "@/routes/api.apps-deploy";
import { claimCookieHeader, withOwner } from "@/lib/agent-access/claims.server";

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const OWNER = "0x00000000000000000000000000000000000000aa";
const SITE = "11111111-2222-3333-4444-555555555555";
const realFetch = globalThis.fetch;
// Rate limits in memory: these tests mock fetch, and only Netlify's calls
// should reach it.
beforeEach(() => {
  delete process.env.RUNNER_URL;
  delete process.env.UPSTASH_REDIS_REST_URL;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.NETLIFY_AUTH_TOKEN;
});

function deploy(body: Record<string, unknown>) {
  const cookie = claimCookieHeader(withOwner(null, OWNER)).split(";")[0];
  return handlers.POST({
    request: new Request("https://devstation.online/api/apps-deploy", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        requesterAddress: OWNER,
        files: { "index.html": "<p>x</p>" },
        ...body,
      }),
    }),
  });
}

describe("deployFilePath", () => {
  it("encodes segments and refuses anything that could leave the deploy", () => {
    expect(deployFilePath("assets/a b.js")).toBe("assets/a%20b.js");
    expect(deployFilePath("../../sites/x")).toBeNull();
    expect(deployFilePath("a/./b")).toBeNull();
    expect(deployFilePath("a//b")).toBeNull();
  });
});

describe("/api/apps-deploy on the operator's token", () => {
  it("refuses a siteId this wallet was not issued", async () => {
    process.env.NETLIFY_AUTH_TOKEN = "operator";
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const res = await deploy({ siteId: SITE });
    expect(res.status).toBe(403);
    expect(called).toBe(false);
  });

  it("refuses a site id that is a domain or a path", async () => {
    const res = await deploy({ siteId: "../../v1/sites/x/deploys/y/restore?" });
    expect(res.status).toBe(400);
  });

  it("refuses a file path that walks out of the deploy", async () => {
    process.env.NETLIFY_AUTH_TOKEN = "operator";
    const res = await deploy({ files: { "index.html": "x", "../../x": "y" } });
    expect(res.status).toBe(400);
  });

  it("accepts the token it issued for the same wallet's site", async () => {
    process.env.NETLIFY_AUTH_TOKEN = "operator";
    const urls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      urls.push(String(url));
      return Response.json({ id: "99999999-2222-3333-4444-555555555555", required: [] });
    }) as unknown as typeof fetch;
    const res = await deploy({ siteId: SITE, siteToken: siteTokenFor(OWNER, SITE) });
    expect(res.status).toBe(200);
    expect(urls[0]).toBe(`https://api.netlify.com/api/v1/sites/${SITE}/deploys`);
  });
});
