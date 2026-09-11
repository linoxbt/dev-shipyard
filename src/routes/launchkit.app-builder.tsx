import { createFileRoute, redirect } from "@tanstack/react-router";

// The App Builder is the Coding Agent now.
//
// They were one product under two names: describe what you want and it builds
// it, whether the starting point is a blank page or a repository you already
// have. The route stays as a redirect because it has been linked to, and a
// dead bookmark is a worse answer than a moved page.

export const Route = createFileRoute("/launchkit/app-builder")({
  beforeLoad: () => {
    throw redirect({ to: "/launchkit/coding-agent", replace: true });
  },
});
