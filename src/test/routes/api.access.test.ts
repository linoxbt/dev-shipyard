import { describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { Route } from "@/routes/api.access";
import { accessMessage } from "@/lib/agent-access/request-auth";

// The grant end to end: nonce, signature over a domain-bound message, cookie.

type Handler = (ctx: { request: Request }) => Promise<Response> | Response;
const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
  .server.handlers;

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const ORIGIN = "https://devstation.online";

function cookieValue(res: Response, name: string): string {
  const all = res.headers.getSetCookie?.() ?? [];
  const hit = all.find((c) => c.startsWith(`${name}=`)) ?? "";
  return hit.split(";")[0].slice(name.length + 1);
}

async function signIn(domain: string, opts: { reuse?: string } = {}) {
  const nonceRes = await handlers.GET({
    request: new Request(`${ORIGIN}/api/access?nonce=1`),
  });
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const sealed = opts.reuse ?? cookieValue(nonceRes, "devstation_access_nonce");
  const issuedAt = Date.now();
  const signature = await account.signMessage({
    message: accessMessage({
      domain,
      uri: `https://${domain}`,
      address: account.address,
      chainId: 1990,
      nonce,
      issuedAt,
    }),
  });
  const res = await handlers.POST({
    request: new Request(`${ORIGIN}/api/access`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "devstation.online",
        cookie: `devstation_access_nonce=${sealed}`,
      },
      body: JSON.stringify({ address: account.address, signature, issuedAt, chainId: 1990 }),
    }),
  });
  return { res, sealed };
}

describe("/api/access", () => {
  it("grants for a signature over this domain and the issued nonce", async () => {
    const { res } = await signIn("devstation.online");
    expect(res.status).toBe(200);
    expect(cookieValue(res, "devstation_jobs").length).toBeGreaterThan(10);
  });

  it("refuses a signature a different site asked for", async () => {
    const { res } = await signIn("evil.example");
    expect(res.status).toBe(401);
    expect(((await res.json()) as { reason: string }).reason).toBe("bad_signature");
  });

  it("refuses without a nonce cookie", async () => {
    const res = await handlers.POST({
      request: new Request(`${ORIGIN}/api/access`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: account.address,
          signature: "0x00",
          issuedAt: Date.now(),
          chainId: 1,
        }),
      }),
    });
    expect(((await res.json()) as { reason: string }).reason).toBe("bad_nonce");
  });

  it("accepts a nonce once", async () => {
    const first = await signIn("devstation.online");
    expect(first.res.status).toBe(200);
    // The same sealed nonce presented again (a captured cookie + signature).
    const nonce = first.sealed.split(".")[0];
    const issuedAt = Date.now();
    const signature = await account.signMessage({
      message: accessMessage({
        domain: "devstation.online",
        uri: ORIGIN,
        address: account.address,
        chainId: 1990,
        nonce,
        issuedAt,
      }),
    });
    const again = await handlers.POST({
      request: new Request(`${ORIGIN}/api/access`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "devstation.online",
          cookie: `devstation_access_nonce=${first.sealed}`,
        },
        body: JSON.stringify({ address: account.address, signature, issuedAt, chainId: 1990 }),
      }),
    });
    expect(((await again.json()) as { reason: string }).reason).toBe("bad_nonce");
  });
});
