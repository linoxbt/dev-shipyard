import { describe, expect, it } from "bun:test";
import { checkReach, pointsAtHost, waitForReach, type ReachDeps } from "./reach.server";

const HOST = "warden.devstation.online";
const expectSite = { slug: "warden", deploy: "d2" };

const answer =
  (headers: Record<string, string>, status = 200) =>
  async () =>
    new Response("<h1>Warden</h1>", { status, headers });

function deps(over: Partial<ReachDeps>): Partial<ReachDeps> {
  return {
    resolveCname: async () => ["cname.vercel-dns.com"],
    resolve4: async () => ["76.76.21.21"],
    fetch: answer({ "x-devstation-site": "warden", "x-devstation-deploy": "d2" }),
    ...over,
  };
}

const tlsError = () => {
  const e = new TypeError("fetch failed") as TypeError & { cause?: unknown };
  e.cause = { code: "ERR_TLS_CERT_ALTNAME_INVALID" };
  return e;
};

describe("reachability", () => {
  it("knows DevStation's host by name or address", () => {
    expect(pointsAtHost(["cname.vercel-dns.com."])).toBe(true);
    expect(pointsAtHost(["7ab20647ecbadf2b.vercel-dns-017.com."])).toBe(true);
    expect(pointsAtHost(["216.198.79.65"])).toBe(true);
    expect(pointsAtHost(["13.140.188.185"])).toBe(false);
  });

  it("is live only when the address serves this site's latest deploy", async () => {
    const r = await checkReach(HOST, expectSite, { deps: deps({}) });
    expect(r.ok).toBe(true);
    expect(r.stage).toBe("live");
  });

  it("says when the name does not resolve", async () => {
    const none = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
    };
    const r = await checkReach(HOST, expectSite, {
      deps: deps({ resolveCname: none, resolve4: none }),
    });
    expect(r).toMatchObject({ ok: false, stage: "dns" });
  });

  it("says when the name points at another server", async () => {
    const r = await checkReach(HOST, expectSite, {
      deps: deps({
        resolveCname: async () => [],
        resolve4: async () => ["13.140.188.185"],
        fetch: async () => {
          throw tlsError();
        },
      }),
    });
    expect(r).toMatchObject({ ok: false, stage: "elsewhere" });
    expect(r.message).toContain("13.140.188.185");

    const other = await checkReach(HOST, expectSite, {
      deps: deps({
        resolveCname: async () => [],
        resolve4: async () => ["1.2.3.4"],
        fetch: answer({ server: "Caddy" }),
      }),
    });
    expect(other.stage).toBe("elsewhere");
  });

  it("tells a missing certificate from a server that does not answer", async () => {
    const tls = await checkReach(HOST, expectSite, {
      deps: deps({
        fetch: async () => {
          throw tlsError();
        },
      }),
    });
    expect(tls.stage).toBe("tls");
    const down = await checkReach(HOST, expectSite, {
      deps: deps({
        fetch: async () => {
          throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
        },
      }),
    });
    expect(down.stage).toBe("http");
  });

  it("notices the version before this one still showing, and waits for it", async () => {
    let calls = 0;
    const r = await waitForReach(HOST, expectSite, {
      gapMs: 1,
      deps: deps({
        fetch: async () =>
          new Response("x", {
            headers: {
              "x-devstation-site": "warden",
              "x-devstation-deploy": ++calls < 2 ? "d1" : "d2",
            },
          }),
      }),
    });
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);

    const stale = await checkReach(HOST, expectSite, {
      deps: deps({ fetch: answer({ "x-devstation-site": "warden", "x-devstation-deploy": "d1" }) }),
    });
    expect(stale.stage).toBe("stale");
  });

  it("does not wait on a record that is missing", async () => {
    let looked = 0;
    const none = async () => {
      looked++;
      throw new Error("ENOTFOUND");
    };
    const r = await waitForReach(HOST, expectSite, {
      gapMs: 1,
      tries: 5,
      deps: deps({ resolveCname: none, resolve4: none }),
    });
    expect(r.stage).toBe("dns");
    expect(looked).toBe(2);
  });
});
