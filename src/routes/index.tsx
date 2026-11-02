import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { CodingAgentPage } from "@/components/coding-agent/CodingAgentPage";
import { CODING_AGENT_ONLY } from "@/lib/feature-flag";
import { loadTemplateSummaries } from "@/lib/data/template-summaries";

// With only the Coding Agent on (lib/features.ts), "/" is the agent itself:
// no landing page in front, the way Base44 and Muse open into the product.
// The full site's marketing page is loaded only when it is the one served.
const MarketingHome = CODING_AGENT_ONLY
  ? null
  : lazy(() => import("@/components/landing/MarketingHome").then((m) => ({ default: m.Landing })));

function Home() {
  if (!MarketingHome) return <CodingAgentPage />;
  return (
    <Suspense fallback={null}>
      <MarketingHome />
    </Suspense>
  );
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: CODING_AGENT_ONLY
          ? "DevStation: build apps and contracts with an agent"
          : "DevStation: the AI agent for apps and smart contracts",
      },
      {
        name: "description",
        content:
          "Ask, research or build. DevStation's agent explains, builds apps, and writes, tests and deploys smart contracts, narrating every step.",
      },
    ],
  }),
  // With only the Coding Agent on (lib/features.ts), "/" is the agent itself:
  // no landing page in front, the way Base44 and Muse open into the product.
  loader: () => (CODING_AGENT_ONLY ? [] : loadTemplateSummaries()),
  component: Home,
});
