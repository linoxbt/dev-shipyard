import { describe, expect, it } from "bun:test";
import { readiness } from "./health.server";

describe("readiness", () => {
  it("fails in production without a session secret, and names it", async () => {
    const h = await readiness({ NODE_ENV: "production" });
    expect(h.ok).toBe(false);
    const secret = h.checks.find((c) => c.name === "session_secret")!;
    expect(secret.ok).toBe(false);
    expect(secret.detail).toContain("SESSION_SECRET");
  });

  it("passes with the required settings, reporting the optional ones", async () => {
    const h = await readiness({ NODE_ENV: "production", SESSION_SECRET: "s".repeat(32) });
    expect(h.ok).toBe(true);
    expect(h.checks.find((c) => c.name === "shared_rate_limits")?.ok).toBe(false);
  });

  it("never echoes a value", async () => {
    const secret = "very-secret-value-123456789012345";
    const h = await readiness({
      NODE_ENV: "production",
      SESSION_SECRET: secret,
      OPENROUTER_API_KEY: secret,
      UPSTASH_REDIS_REST_URL: "https://x",
      UPSTASH_REDIS_REST_TOKEN: secret,
    });
    expect(JSON.stringify(h)).not.toContain(secret);
  });
});
