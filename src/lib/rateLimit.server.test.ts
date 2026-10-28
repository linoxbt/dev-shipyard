import { afterEach, describe, expect, it } from "bun:test";
import {
  checkMemoryLimit,
  checkRateLimit,
  clientKeyFromRequest,
  resetMemoryLimits,
  resetRunnerBreaker,
} from "./rateLimit.server";

const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });

afterEach(() => {
  resetMemoryLimits();
  resetRunnerBreaker();
});

describe("clientKeyFromRequest", () => {
  it("prefers the platform's own client-ip header over X-Forwarded-For", () => {
    expect(
      clientKeyFromRequest(
        req({ "x-nf-client-connection-ip": "203.0.113.9", "x-forwarded-for": "1.1.1.1" }),
        { NETLIFY: "true" },
      ),
    ).toBe("203.0.113.9");
  });

  it("never uses the client-written leftmost X-Forwarded-For entry", () => {
    expect(clientKeyFromRequest(req({ "x-forwarded-for": "6.6.6.6, 198.51.100.4" }), {})).toBe(
      "198.51.100.4",
    );
  });

  it("ignores values that are not addresses", () => {
    expect(
      clientKeyFromRequest(req({ "x-real-ip": "<script>" }), { TRUSTED_IP_HEADER: "x-real-ip" }),
    ).toBe("unknown");
  });

  it("reads only the current platform's header, never another platform's", () => {
    // On Vercel a client can send Netlify's header; it must not win.
    const spoofed = req({
      "x-nf-client-connection-ip": "6.6.6.6",
      "x-vercel-forwarded-for": "203.0.113.7",
    });
    expect(clientKeyFromRequest(spoofed, { VERCEL: "1" })).toBe("203.0.113.7");
    // Netlify's header counts only on Netlify.
    expect(clientKeyFromRequest(spoofed, { SITE_ID: "s", DEPLOY_ID: "d" })).toBe("6.6.6.6");
    expect(
      clientKeyFromRequest(
        req({ "x-nf-client-connection-ip": "6.6.6.6", "x-forwarded-for": "198.51.100.9" }),
        {},
      ),
    ).toBe("198.51.100.9");
    // Self-hosted without a configured header: x-real-ip is client-writable.
    expect(clientKeyFromRequest(req({ "x-real-ip": "6.6.6.6" }), {})).toBe("unknown");
    expect(
      clientKeyFromRequest(req({ "x-real-ip": "198.51.100.2" }), {
        TRUSTED_IP_HEADER: "X-Real-IP",
      }),
    ).toBe("198.51.100.2");
  });
});

describe("checkMemoryLimit", () => {
  it("allows up to the limit and then refuses", () => {
    expect(checkMemoryLimit("k", 2, 1000, 0)).toBe(true);
    expect(checkMemoryLimit("k", 2, 1000, 1)).toBe(true);
    expect(checkMemoryLimit("k", 2, 1000, 2)).toBe(false);
    expect(checkMemoryLimit("k", 2, 1000, 1500)).toBe(true);
  });

  it("does not let key rotation evict a global cap", () => {
    expect(checkMemoryLimit("x:global", 1, 60_000, 0)).toBe(true);
    for (let i = 0; i < 6000; i++) checkMemoryLimit(`rot:${i}`, 1, 60_000, 1);
    expect(checkMemoryLimit("x:global", 1, 60_000, 2)).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("falls back to memory with no shared store configured", async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.RUNNER_URL;
    expect(await checkRateLimit("a", 1, 60_000)).toBe(true);
    expect(await checkRateLimit("a", 1, 60_000)).toBe(false);
  });

  it("uses the runner's shared counters when the runner is configured", async () => {
    const { RateStore } = await import("../../services/runner/src/rate-store");
    const store = new RateStore();
    const realFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push(String(url));
      const b = JSON.parse(String(init.body)) as { key: string; limit: number; windowMs: number };
      return Response.json({ ok: true, allowed: store.hit(b.key, b.limit, b.windowMs) });
    }) as unknown as typeof fetch;
    process.env.RUNNER_URL = "https://runner.test/";
    process.env.RUNNER_TOKEN = "t".repeat(32);
    delete process.env.UPSTASH_REDIS_REST_URL;
    try {
      expect(await checkRateLimit("shared", 1, 60_000)).toBe(true);
      // Memory never saw it; the runner did, so a second instance is refused.
      resetMemoryLimits();
      expect(await checkRateLimit("shared", 1, 60_000)).toBe(false);
      expect(seen[0]).toBe("https://runner.test/limits/hit");
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RUNNER_URL;
      delete process.env.RUNNER_TOKEN;
    }
  });

  it("falls back to memory when the runner cannot be reached", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    process.env.RUNNER_URL = "https://runner.test";
    process.env.RUNNER_TOKEN = "t".repeat(32);
    try {
      expect(await checkRateLimit("down", 1, 60_000)).toBe(true);
      expect(await checkRateLimit("down", 1, 60_000)).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RUNNER_URL;
      delete process.env.RUNNER_TOKEN;
    }
  });

  it("stops asking a runner that just failed, instead of waiting on it every request", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("unauthorized", { status: 401 });
    }) as unknown as typeof fetch;
    process.env.RUNNER_URL = "https://runner.test";
    process.env.RUNNER_TOKEN = "t".repeat(32);
    try {
      for (let i = 0; i < 5; i++) await checkRateLimit(`k${i}`, 10, 60_000);
      expect(calls).toBe(1);
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.RUNNER_URL;
      delete process.env.RUNNER_TOKEN;
    }
  });
});
