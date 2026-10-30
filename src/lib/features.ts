import { isPassthrough } from "@/lib/site-hosts";

// Which of DevStation's features this deployment serves.
//
// The app is currently shipped as the Coding Agent alone. Every other feature
// (the explorer, analytics, the dashboard, the marketplace, the contract
// editor, deploys, the routebook, settings and the rest of the docs) is still
// in the code base, untouched, but switched off: its pages redirect to the
// Coding Agent and nothing links to them.
//
// To bring everything back, set VITE_CODING_AGENT_ONLY=0 at build time.

export const CODING_AGENT_ONLY = String(import.meta.env.VITE_CODING_AGENT_ONLY ?? "1") !== "0";

/** Where the app opens, and where a switched-off page sends you. */
export const AGENT_HOME = "/launchkit/coding-agent";

/** Pages that stay on when only the Coding Agent is served: the agent itself,
 *  and its own and the CLI's documentation, which the agent links to. */
const AGENT_PAGES = [
  /^\/launchkit\/coding-agent\/?$/,
  /^\/docs\/coding-agent\/?$/,
  /^\/docs\/cli(\/.*)?$/,
];

/** Whether `pathname` is served in Coding-Agent-only mode. API routes, server
 *  functions and files always are: the agent runs on them. */
export function servedInAgentOnly(pathname: string): boolean {
  return isPassthrough(pathname) || AGENT_PAGES.some((re) => re.test(pathname));
}

/** Where to send `pathname`, or null to serve it. */
export function agentOnlyRedirect(pathname: string, enabled = CODING_AGENT_ONLY): string | null {
  if (!enabled || servedInAgentOnly(pathname)) return null;
  return AGENT_HOME;
}
