import { afterEach, describe, expect, it } from "bun:test";
import { linkedGithub } from "./github-link.server";
import { sealSession } from "./github-oauth.server";
import { claimCookieHeader, withOwner } from "./agent-access/claims.server";

process.env.SESSION_SECRET ??= "test-secret-for-sessions-0123456789";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  // stub() points these at a fake runner; left set, every later test file's
  // rate limiter would call it through whatever fetch that file mocks.
  delete process.env.RUNNER_URL;
  delete process.env.RUNNER_TOKEN;
});

const OWNER = "0x00000000000000000000000000000000000000cc";

function request(withGrant = true) {
  const cookies = [`devstation_gh=${sealSession("gho_tok")}`];
  if (withGrant) cookies.push(claimCookieHeader(withOwner(null, OWNER)).split(";")[0]);
  return new Request("https://devstation.online/api/workspace", {
    headers: { cookie: cookies.join("; ") },
  });
}

function stub(linkedId: number | null) {
  process.env.RUNNER_URL = "https://runner.test";
  process.env.RUNNER_TOKEN = "t".repeat(40);
  globalThis.fetch = (async (url: string) => {
    if (String(url) === "https://api.github.com/user") {
      return Response.json({ id: 7, login: "me", avatar_url: "", name: null });
    }
    return Response.json({
      ok: true,
      account: { github: linkedId === null ? null : { id: linkedId, login: "other" } },
    });
  }) as unknown as typeof fetch;
}

describe("linkedGithub", () => {
  it("passes when the session is the account linked to the wallet", async () => {
    stub(7);
    const r = await linkedGithub(request());
    expect(r.ok && r.token).toBe("gho_tok");
  });

  it("refuses a different GitHub account", async () => {
    stub(99);
    const r = await linkedGithub(request(), "open a pull request");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("not_linked");
      expect(r.status).toBe(403);
    }
  });

  it("refuses with no wallet grant", async () => {
    stub(7);
    const r = await linkedGithub(request(false));
    expect(!r.ok && r.reason).toBe("no_grant");
  });
});
