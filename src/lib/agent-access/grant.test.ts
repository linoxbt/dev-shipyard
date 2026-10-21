import { afterEach, describe, expect, it } from "bun:test";
import { canRequestGrant, ensureGrant, fetchWithGrant, setGrantSigner } from "./grant";

// The browser half of the access grant.
//
// The behaviour worth holding: it asks for a signature only when the server
// says one is missing, it never asks twice at once, and it never loops.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  setGrantSigner({ address: null, sign: null });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The nonce request is answered here for every test, so each one states only
// the behaviour it is about.
function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = [];
  globalThis.fetch = ((input: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${input}`);
    if (String(input) === "/api/access?nonce=1") {
      return Promise.resolve(json(200, { ok: true, nonce: "a".repeat(32) }));
    }
    return Promise.resolve(handler(String(input), init));
  }) as typeof fetch;
  return calls;
}

(globalThis as { location?: unknown }).location ??= {
  host: "devstation.online",
  origin: "https://devstation.online",
};

const OWNER = "0xabc0000000000000000000000000000000000001";

describe("asking only when asked to", () => {
  it("does not sign anything when the request succeeds", async () => {
    let signed = 0;
    setGrantSigner({
      address: OWNER,
      sign: async () => {
        signed++;
        return "0xsig";
      },
    });
    const calls = stubFetch(() => json(200, { ok: true }));

    const res = await fetchWithGrant("/api/build", { method: "POST" });
    expect(res.status).toBe(200);
    // The whole point of being reactive: someone who already holds a grant, or
    // is hitting an endpoint that does not need one, is never prompted.
    expect(signed).toBe(0);
    expect(calls).toEqual(["POST /api/build"]);
  });

  it("does not sign for a 401 that is not about the grant", async () => {
    let signed = 0;
    setGrantSigner({
      address: OWNER,
      sign: async () => {
        signed++;
        return "0xsig";
      },
    });
    stubFetch(() => json(401, { ok: false, reason: "not_signed_in" }));

    const res = await fetchWithGrant("/api/repo-agent");
    expect(res.status).toBe(401);
    expect(signed).toBe(0);
  });

  it("signs once on a missing grant, then retries the original request", async () => {
    let signed = 0;
    setGrantSigner({
      address: OWNER,
      sign: async () => {
        signed++;
        return "0xsig";
      },
    });
    let granted = false;
    const calls = stubFetch((url) => {
      if (url === "/api/access") {
        granted = true;
        return json(200, { ok: true, owner: OWNER });
      }
      return granted ? json(200, { ok: true, id: "agent-1" }) : json(401, { reason: "no_grant" });
    });

    const res = await fetchWithGrant("/api/agent", { method: "POST" });
    expect(res.status).toBe(200);
    expect(signed).toBe(1);
    expect(calls).toEqual([
      "POST /api/agent",
      "GET /api/access?nonce=1",
      "POST /api/access",
      "POST /api/agent",
    ]);
  });

  it("re-signs when the cookie belongs to the previously connected wallet", async () => {
    let signed = 0;
    setGrantSigner({
      address: OWNER,
      sign: async () => {
        signed++;
        return "0xsig";
      },
    });
    let granted = false;
    stubFetch((url) => {
      if (url === "/api/access") {
        granted = true;
        return json(200, { ok: true, owner: OWNER });
      }
      return granted ? json(200, { ok: true }) : json(403, { reason: "owner_mismatch" });
    });

    const res = await fetchWithGrant("/api/publish", { method: "POST" });
    expect(res.status).toBe(200);
    expect(signed).toBe(1);
  });

  it("signs a domain-bound message carrying the server's nonce", async () => {
    let message = "";
    setGrantSigner({
      address: OWNER,
      sign: async (args) => {
        message = args.message;
        return "0xsig";
      },
      chainId: 1990,
    });
    stubFetch(() => json(200, { ok: true }));
    await ensureGrant();
    expect(message).toContain("devstation.online wants you to sign in");
    expect(message).toContain(`Nonce: ${"a".repeat(32)}`);
    expect(message).toContain("Chain ID: 1990");
  });

  it("gives up after one retry rather than looping", async () => {
    setGrantSigner({ address: OWNER, sign: async () => "0xsig" });
    // A server that never accepts the grant. Retrying this forever is how an
    // app ends up spamming wallet prompts.
    const calls = stubFetch((url) =>
      url === "/api/access" ? json(200, { ok: true }) : json(401, { reason: "no_grant" }),
    );

    const res = await fetchWithGrant("/api/agent", { method: "POST" });
    expect(res.status).toBe(401);
    expect(calls.filter((c) => c === "POST /api/access")).toHaveLength(1);
  });

  it("does not prompt when the user declines", async () => {
    setGrantSigner({
      address: OWNER,
      sign: () => Promise.reject(new Error("user rejected")),
    });
    const calls = stubFetch(() => json(401, { reason: "no_grant" }));

    const res = await fetchWithGrant("/api/agent", { method: "POST" });
    expect(res.status).toBe(401);
    // Declining is an answer. It must not become a POST to /api/access with no
    // signature, and it must not retry.
    expect(calls).toEqual(["POST /api/agent", "GET /api/access?nonce=1"]);
  });

  it("does nothing at all with no wallet connected", async () => {
    expect(canRequestGrant()).toBe(false);
    stubFetch(() => json(401, { reason: "no_grant" }));
    expect(await ensureGrant()).toBe(false);
  });

  it("opens one wallet prompt for concurrent callers", async () => {
    // Two panels starting work at the same moment. A second prompt for the
    // same signature reads as the app malfunctioning.
    let signed = 0;
    setGrantSigner({
      address: OWNER,
      sign: async () => {
        signed++;
        await new Promise((r) => setTimeout(r, 20));
        return "0xsig";
      },
    });
    stubFetch(() => json(200, { ok: true }));

    const [a, b] = await Promise.all([ensureGrant(), ensureGrant()]);
    expect(a && b).toBe(true);
    expect(signed).toBe(1);
  });
});
