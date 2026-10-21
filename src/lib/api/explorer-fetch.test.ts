import { describe, expect, it, afterEach } from "bun:test";
import {
  clearExplorerCache,
  fetchExplorer,
  fetchExplorerCached,
  fallbackEnabled,
  mayRelax,
} from "./explorer-fetch";

// These are guardrails, not coverage. Relaxing certificate verification is a
// deliberate, narrow exemption for QIE's expired explorer certificate; the
// danger is that it quietly widens later. Each test pins one edge of it.

const original = process.env.EXPLORER_ALLOW_EXPIRED_CERT;
const realFetch = globalThis.fetch;

/** fetch that fails the way Node/Bun do, so these never touch the network:
 *  they used to, and passed offline for the wrong reason (and failed behind a
 *  proxy that answers unknown hosts with a 502). */
function failFetchWith(message: string, code: string) {
  globalThis.fetch = (async () => {
    throw Object.assign(new TypeError("fetch failed"), { cause: { message, code } });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (original === undefined) delete process.env.EXPLORER_ALLOW_EXPIRED_CERT;
  else process.env.EXPLORER_ALLOW_EXPIRED_CERT = original;
});

describe("fallbackEnabled", () => {
  it("defaults off: verification is relaxed only when the operator asks", () => {
    delete process.env.EXPLORER_ALLOW_EXPIRED_CERT;
    expect(fallbackEnabled()).toBe(false);
  });

  it("is switchable on by the operator", () => {
    for (const on of ["1", "true", "on", "ON", "True"]) {
      process.env.EXPLORER_ALLOW_EXPIRED_CERT = on;
      expect(fallbackEnabled()).toBe(true);
    }
  });

  it("treats any other value as off", () => {
    for (const v of ["0", "yes", "false", ""]) {
      process.env.EXPLORER_ALLOW_EXPIRED_CERT = v;
      expect(fallbackEnabled()).toBe(false);
    }
  });
});

describe("fetchExplorer scoping", () => {
  it("refuses a bad certificate on a host that is not in our chain config", async () => {
    // The whole point: the exemption is for OUR explorers, not for any host
    // that happens to have an expired certificate.
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "1";
    failFetchWith("certificate has expired", "CERT_HAS_EXPIRED");
    await expect(fetchExplorer("https://expired.badssl.com/")).rejects.toThrow("fetch failed");
  });

  // The two below assert what we PERMIT, not what a third party's certificate
  // happens to be doing. They previously called the live QIE explorer and
  // asserted it threw, which only held while QIE's certificate was expired; it
  // was renewed on 2026-09-03 and both started failing without anything in this
  // repo changing.
  it("refuses even a configured host when the operator switched it off", () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "0";
    expect(mayRelax("https://mainnet.qie.digital/api/v2/stats")).toBe(false);
  });

  it("never retries a write insecurely", () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "1";
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      expect(mayRelax("https://mainnet.qie.digital/api/v2/stats", method)).toBe(false);
    }
  });

  it("permits a configured host for a read while the fallback is on", () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "1";
    expect(mayRelax("https://mainnet.qie.digital/api/v2/stats")).toBe(true);
    expect(mayRelax("https://mainnet.qie.digital/api/v2/stats", "GET")).toBe(true);
  });

  it("permits nothing for a host outside our chain config", () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "1";
    expect(mayRelax("https://expired.badssl.com/")).toBe(false);
    expect(mayRelax("not a url")).toBe(false);
  });

  it("does not turn a DNS failure into an insecure retry", async () => {
    // Not a certificate problem, so the fallback must not engage at all, even
    // on a configured host with the fallback on.
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "1";
    failFetchWith("getaddrinfo ENOTFOUND mainnet.qie.digital", "ENOTFOUND");
    await expect(fetchExplorer("https://mainnet.qie.digital/api/v2/stats")).rejects.toThrow(
      "fetch failed",
    );
  });

  it("does not relax a configured host's certificate unless the operator opted in", async () => {
    delete process.env.EXPLORER_ALLOW_EXPIRED_CERT;
    failFetchWith("certificate has expired", "CERT_HAS_EXPIRED");
    await expect(fetchExplorer("https://mainnet.qie.digital/api/v2/stats")).rejects.toThrow(
      "fetch failed",
    );
  });
});

describe("fetchExplorerCached", () => {
  afterEach(() => clearExplorerCache());

  it("shares one upstream request between concurrent and repeated reads", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return Response.json({ result: [1, 2] });
    }) as unknown as typeof fetch;
    const url = "https://explorer.test/api?module=account&action=txlist";
    const [a, b] = await Promise.all([fetchExplorerCached(url), fetchExplorerCached(url)]);
    const c = await fetchExplorerCached(url);
    expect(calls).toBe(1);
    // Each caller gets its own readable body.
    for (const r of [a, b, c]) expect(await r.json()).toEqual({ result: [1, 2] });
  });

  it("does not keep a failed response", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("busy", { status: 503 });
    }) as unknown as typeof fetch;
    const url = "https://explorer.test/api?x=1";
    expect((await fetchExplorerCached(url)).status).toBe(503);
    expect((await fetchExplorerCached(url)).status).toBe(503);
    expect(calls).toBe(2);
  });
});
