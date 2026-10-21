// Two things every response from this server needs, applied once in
// src/server.ts so no host's config file can forget them.
//
// 1. Cross-site request refusal for anything that changes state.
//
//    The claim and GitHub cookies are SameSite=Lax, and Lax is about SITES,
//    not origins: an app a stranger published at evil.devstation.online is the
//    same site as devstation.online, so its requests carried a visitor's
//    cookies. Every route also read its body with request.json(), which
//    ignores content-type, so a text/plain POST -- one that needs no CORS
//    preflight -- reached the handler. Together: a published app could start
//    agent runs, publishes and deploys as whoever opened it.
//
//    So a mutating request must come from one of this deployment's own
//    origins, and an /api body must be declared as JSON.
//
// 2. Security headers. Netlify's netlify.toml set them; Vercel (the default
//    build preset) set none. Setting them here covers every host.

import { hostKind } from "./site-hosts";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** The origin this request was addressed to, as the browser saw it. Behind a
 *  CDN request.url can be the function's internal URL, so Host wins. */
export function ownOrigin(request: Request): string | null {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
    const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
    return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether `origin` is one of this deployment's own front doors. */
export function isFirstPartyOrigin(origin: string, request: Request, root?: string): boolean {
  const o = origin.toLowerCase();
  if (o === ownOrigin(request)) return true;
  try {
    const u = new URL(o);
    if (u.protocol !== "https:") return false;
    // The landing page, docs. and console. are one deployment. Any OTHER
    // subdomain of the root is a user's published app, and is refused.
    return hostKind(u.host, root) !== null;
  } catch {
    return false;
  }
}

export type GuardProblem = "cross_site" | "not_json";

/** Why this request must be refused, or null when it may proceed. */
export function requestProblem(request: Request, root?: string): GuardProblem | null {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin) {
    // "null" is a sandboxed iframe (an app preview) or a file: page.
    if (origin === "null" || !isFirstPartyOrigin(origin, request, root)) return "cross_site";
  } else if (site && site !== "same-origin" && site !== "none") {
    return "cross_site";
  }
  // No Origin and no Sec-Fetch-Site is not a browser, and so carries no
  // visitor's cookies: nothing to forge.

  const path = new URL(request.url).pathname;
  if (path.startsWith("/api/")) {
    const length = request.headers.get("content-length");
    // Browsers send content-length: 0 for an empty POST; a streamed body has
    // no length at all, and is a body.
    const hasBody = length !== null ? length !== "0" : request.body !== null;
    const type = (request.headers.get("content-type") ?? "").toLowerCase();
    if (hasBody && !type.startsWith("application/json")) return "not_json";
  }
  return null;
}

export function refusal(problem: GuardProblem): Response {
  const message =
    problem === "cross_site"
      ? "This request did not come from DevStation, so it was refused."
      : "Send this request as application/json.";
  return Response.json(
    { ok: false, reason: problem, message, error: { message } },
    { status: problem === "cross_site" ? 403 : 415 },
  );
}

// script-src is report-only: wallet SDKs, the solc worker and Monaco load from
// several hosts and a guessed enforcing policy that breaks wallet connect in
// production is worse than none. The report shows what an enforcing one needs.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://binaries.soliditylang.org",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy": "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
  "content-security-policy-report-only": CSP_REPORT_ONLY,
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "permissions-policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  "strict-transport-security": "max-age=63072000; includeSubDomains",
};

/** Adds any security header the response does not already set. */
export function withSecurityHeaders(response: Response): Response {
  const missing = Object.entries(SECURITY_HEADERS).filter(([k]) => !response.headers.has(k));
  if (missing.length === 0) return response;
  try {
    for (const [k, v] of missing) response.headers.set(k, v);
    return response;
  } catch {
    // Immutable headers (a fetched Response passed through): copy.
    const headers = new Headers(response.headers);
    for (const [k, v] of missing) headers.set(k, v);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
}
