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
    isPassthrough(pathname) ||
    DOCS_KEPT.some((re) => re.test(pathname))
  );
}

/** Whether `pathname` is a page this deployment does not serve. Such a page
 *  is simply not found: nothing redirects, so the agent has one address, "/". */
export function switchedOff(pathname: string, enabled = CODING_AGENT_ONLY): boolean {
  return enabled && !servedInAgentOnly(pathname);
}
