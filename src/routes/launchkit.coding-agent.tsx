import { createFileRoute } from "@tanstack/react-router";
import { CodingAgentPage } from "@/components/coding-agent/CodingAgentPage";

// The Coding Agent's own address. When the app ships as the agent alone
// (lib/features.ts) the agent is served at "/" and this address redirects
// there; see src/routes/index.tsx.

export const Route = createFileRoute("/launchkit/coding-agent")({
  head: () => ({ meta: [{ title: "Coding Agent: DevStation" }] }),
  component: CodingAgentPage,
});
