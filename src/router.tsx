import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { hostKind, toInternalPath, toPublicPath } from "@/lib/site-hosts";

export const getRouter = () => {
  const queryClient = new QueryClient();

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
