import { describe, expect, it, afterEach } from "bun:test";
import { fetchExplorer, fallbackEnabled } from "./explorer-fetch";

// These are guardrails, not coverage. Relaxing certificate verification is a
// deliberate, narrow exemption for QIE's expired explorer certificate; the
// danger is that it quietly widens later. Each test pins one edge of it.

const original = process.env.EXPLORER_ALLOW_EXPIRED_CERT;
afterEach(() => {
  if (original === undefined) delete process.env.EXPLORER_ALLOW_EXPIRED_CERT;
  else process.env.EXPLORER_ALLOW_EXPIRED_CERT = original;
});

describe("fallbackEnabled", () => {
  it("defaults on, so the explorer works out of the box", () => {
    delete process.env.EXPLORER_ALLOW_EXPIRED_CERT;
    expect(fallbackEnabled()).toBe(true);
  });

  it("is switchable off by the operator", () => {
    for (const off of ["0", "false", "off", "OFF", "False"]) {
      process.env.EXPLORER_ALLOW_EXPIRED_CERT = off;
      expect(fallbackEnabled()).toBe(false);
    }
  });

  it("treats any other value as on rather than silently disabling", () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "yes";
    expect(fallbackEnabled()).toBe(true);
  });
});

describe("fetchExplorer scoping", () => {
  it("refuses a bad certificate on a host that is not in our chain config", async () => {
    // The whole point: the exemption is for OUR explorers, not for any host
    // that happens to have an expired certificate.
    await expect(fetchExplorer("https://expired.badssl.com/")).rejects.toThrow();
  }, 30_000);

  it("refuses even a configured host when the operator switched it off", async () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "0";
    await expect(fetchExplorer("https://mainnet.qie.digital/api/v2/stats")).rejects.toThrow();
  }, 30_000);

  it("never retries a write insecurely", async () => {
    process.env.EXPLORER_ALLOW_EXPIRED_CERT = "1";
    await expect(
      fetchExplorer("https://mainnet.qie.digital/api/v2/stats", { method: "POST" }),
    ).rejects.toThrow();
  }, 30_000);

  it("does not turn a DNS failure into an insecure retry", async () => {
    // Not a certificate problem, so the fallback must not engage at all.
    await expect(
      fetchExplorer("https://no-such-host.mainnet.qie.digital.invalid/api/v2/stats"),
    ).rejects.toThrow();
  }, 30_000);
});
