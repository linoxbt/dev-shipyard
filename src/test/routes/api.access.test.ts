import { describe, expect, it } from "bun:test";
import { Route } from "@/routes/api.access";

// The wallet signature sign-in is retired: sign-in is email codes only.

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

describe("/api/access", () => {
  it("refuses a wallet sign-in, whatever it carries", async () => {
    const res = await handlers.POST({
      request: new Request("https://devstation.online/api/access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: "0xabc", signature: "0xsig", nonce: "n" }),
      }),
    });
    expect(res.status).toBe(410);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("says there is no session without the cookie", async () => {
    const res = await handlers.GET({
      request: new Request("https://devstation.online/api/access"),
    });
    expect(await res.json()).toEqual({ ok: true, granted: false, owner: null });
  });
});
