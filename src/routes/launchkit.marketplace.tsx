import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";

// The marketplace: one place to find, buy and sell what builders make on
// DevStation. Contract templates, whole apps, agent skills and UI kits, priced
// in QIE or QUSDC. The Templates page folded into it: built-in templates are
// listed here as official, free listings.
//
// This file is the layout. Browse, a listing, Sell, Earnings and Library are
// its children.

export const Route = createFileRoute("/launchkit/marketplace")({
  // Gated on the shared map, never on a flag local to this file: the sidebar
  // badge reads the same entry, so the two cannot disagree. Marketplace stays
  // referenced, so removing the map entry is all it takes to bring it back.
  component: () =>
    isComingSoon("/launchkit/marketplace") ? (
      <ComingSoon path="/launchkit/marketplace" />
    ) : (
      <Marketplace />
    ),
});

function Marketplace() {
  return <Outlet />;
}
