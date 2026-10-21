import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { hostKind, toInternalPath, toPublicPath } from "@/lib/site-hosts";

export const getRouter = () => {
  // Defaults for every query that does not set its own. With none, data was
  // stale the instant it arrived and every window focus refetched every
  // mounted query: on the landing page that was dozens of RPC and explorer
  // calls for an alt-tab. Polling queries keep their own intervals, and React
  // Query already stops those while the tab is hidden.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        retry: 2,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    // docs.devstation.online/cli is the /docs/cli route, and
    // console.devstation.online/ is the overview. See lib/site-hosts.ts.
    rewrite: {
      input: ({ url }) => {
        const next = toInternalPath(hostKind(url.host), url.pathname);
        if (next === url.pathname) return undefined;
        const copy = new URL(url.href);
        copy.pathname = next;
        return copy;
      },
      output: ({ url }) => {
        const next = toPublicPath(hostKind(url.host), url.pathname);
        if (next === url.pathname) return undefined;
        const copy = new URL(url.href);
        copy.pathname = next;
        return copy;
      },
    },
  });

  return router;
};
