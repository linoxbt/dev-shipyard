import { CODING_AGENT_ONLY } from "@/lib/feature-flag";
import { isPassthrough } from "@/lib/site-hosts";

// Which of DevStation's features this deployment serves.
//
// The app is currently shipped as the Coding Agent alone. Every other feature
// (the explorer, analytics, the dashboard, the marketplace, the contract
// editor, deploys, the routebook, settings and the rest of the docs) is still
// in the code base, untouched, but switched off: its pages are not found and
// nothing links to them. Nothing redirects; the agent has one address, "/".
//
// The agent is served at "/", with no landing page in front of it, the way
// builder apps like Base44 and Muse open straight into the product.
//
// To bring everything back, set VITE_CODING_AGENT_ONLY=0 at build time.

export { CODING_AGENT_ONLY };

/** Where the Coding Agent lives. Like Base44 or Muse, the app opens straight
 *  into it: "/" when it is all there is, its own page otherwise. */
export const AGENT_PATH = CODING_AGENT_ONLY ? "/" : "/launchkit/coding-agent";

/** The agent's docs and the CLI's, which the agent links to. */
const DOCS_KEPT = [/^\/docs\/coding-agent\/?$/, /^\/docs\/cli(\/.*)?$/];

/** Whether `pathname` is served in Coding-Agent-only mode: the agent at "/",
 *  its docs, and the API, server functions and files the agent runs on. */
export function servedInAgentOnly(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/cookies" ||
    // The admins' figures (the page itself checks who is asking).
    pathname === "/admin/stats" ||
    pathname === "/admin/templates" ||
    pathname === "/admin/access" ||
    pathname === "/admin/feedback" ||
    pathname === "/feedback" ||
    // Credit and usage, and a shared read-only copy of the figures.
    pathname === "/credits" ||
    // The account's own pages.
    pathname === "/account" ||
    pathname === "/connections" ||
    pathname === "/updates" ||
    pathname === "/publish" ||
    /^\/stats\/shared\/[A-Za-z0-9_-]{16,80}$/.test(pathname) ||
    isPassthrough(pathname) ||
    DOCS_KEPT.some((re) => re.test(pathname))
  );
}

/** Whether `pathname` is a page this deployment does not serve. Such a page
 *  is simply not found: nothing redirects, so the agent has one address, "/". */
export function switchedOff(pathname: string, enabled = CODING_AGENT_ONLY): boolean {
  return enabled && !servedInAgentOnly(pathname);
}

/**
 * The API the Coding Agent runs on. With only the agent on, every other API
 * route and server function (the legacy builder, marketplace, chain and
 * explorer endpoints) answers 404: nothing the product does not use is left
 * reachable, including routes that would spend model credit or relay chain
 * transactions outside the agent's checks.
 */
const AGENT_API = [
  /^\/api\/workspace$/,
  /^\/api\/model(\/turn|\/heartbeat)?$/,
  /^\/api\/plan$/,
  /^\/api\/projects$/,
  /^\/api\/credits$/,
  /^\/api\/billing$/,
  /^\/api\/sites$/,
  /^\/api\/payments\/(stripe|paystack)$/,
  /^\/api\/stats\/shared$/,
  /^\/api\/connectors$/,
  /^\/api\/oauth\/[a-z]+(\/callback)?$/,
  /^\/api\/metrics$/,
  /^\/api\/admin\/(stats|templates|access|feedback)$/,
  /^\/api\/feedback$/,
  /^\/api\/templates$/,
  /^\/api\/access(\/session)?$/,
  /^\/api\/github(\/callback|\/push)?$/,
  /^\/api\/health$/,
  /^\/api\/version$/,
  /^\/api\/cron\/sandboxes$/,
];

/** Whether an API path or server function is served in Coding-Agent-only mode. */
export function apiServedInAgentOnly(pathname: string, enabled = CODING_AGENT_ONLY): boolean {
  if (!enabled) return true;
  const path = routerPath(pathname);
  if (path === null) return false;
  if (path.startsWith("/_serverfn")) return false;
  if (!path.startsWith("/api/") && path !== "/api") return true;
  return AGENT_API.some((re) => re.test(path));
}

/**
 * The path as the router matches it: without percent-encoding, repeated
 * slashes or case. The router ignores case, so "/API/ai" reaches the /api/ai
 * route; checked as sent, it would slip past a list of lower-case paths.
 * null when it does not decode, which nothing serves.
 */
export function routerPath(pathname: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  return path.replace(/\/{2,}/g, "/").toLowerCase();
}
