import { describe, expect, it } from "bun:test";
import { requestProblem, SECURITY_HEADERS, withSecurityHeaders } from "./http-guard.server";

const ROOT = "devstation.online";

function post(url: string, headers: Record<string, string>, body = "{}") {
  return new Request(url, { method: "POST", headers, body });
}

describe("requestProblem", () => {
  it("lets same-origin JSON through", () => {
    const r = post("https://devstation.online/api/agent", {
      origin: "https://devstation.online",
      "content-type": "application/json",
    });
    expect(requestProblem(r, ROOT)).toBeNull();
  });

  it("allows the deployment's own front doors", () => {
    const r = post("https://devstation.online/api/agent", {
      origin: "https://console.devstation.online",
      "content-type": "application/json",
    });
    expect(requestProblem(r, ROOT)).toBeNull();
  });

  it("refuses a user's published app on a sibling subdomain", () => {
    const r = post("https://devstation.online/api/agent", {
      origin: "https://evil.devstation.online",
      "content-type": "application/json",
    });
    expect(requestProblem(r, ROOT)).toBe("cross_site");
  });

  it("refuses a sandboxed preview iframe (Origin: null)", () => {
    const r = post("https://devstation.online/api/agent", {
      origin: "null",
      "content-type": "application/json",
    });
    expect(requestProblem(r, ROOT)).toBe("cross_site");
  });

  it("refuses cross-site by Sec-Fetch-Site when Origin is absent", () => {
    const r = post("https://devstation.online/api/agent", {
      "sec-fetch-site": "same-site",
      "content-type": "application/json",
    });
    expect(requestProblem(r, ROOT)).toBe("cross_site");
  });

  it("refuses a text/plain body, the kind that skips a CORS preflight", () => {
    const r = post("https://devstation.online/api/agent", {
      origin: "https://devstation.online",
      "content-type": "text/plain",
    });
    expect(requestProblem(r, ROOT)).toBe("not_json");
  });

  it("lets a bodyless POST through (sign-out sends no body and no type)", () => {
    const r = new Request("https://devstation.online/api/github", {
      method: "POST",
      headers: { origin: "https://devstation.online" },
    });
    expect(requestProblem(r, ROOT)).toBeNull();
  });

  it("refuses a declared non-JSON type even without a length", () => {
    const r = new Request("https://devstation.online/api/agent", {
      method: "POST",
      headers: { origin: "https://devstation.online", "content-type": "text/plain" },
    });
    expect(requestProblem(r, ROOT)).toBe("not_json");
  });

  it("never blocks a read", () => {
    const r = new Request("https://devstation.online/api/agent", {
      headers: { origin: "https://evil.example" },
    });
    expect(requestProblem(r, ROOT)).toBeNull();
  });
});

describe("withSecurityHeaders", () => {
  it("sets every header without overriding one a route chose", () => {
    const res = withSecurityHeaders(
      new Response("x", { headers: { "referrer-policy": "no-referrer" } }),
    );
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    for (const k of Object.keys(SECURITY_HEADERS)) expect(res.headers.has(k)).toBe(true);
  });
});
