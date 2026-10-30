import { ReactNode, useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { WrongNetworkBanner } from "./WrongNetworkBanner";
import { useProjects } from "@/lib/data/projects";
import { useUi } from "@/lib/ui-state";
import { Logo } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";

/** `bare`: no sidebar or app bars, the page has the whole window. Used when
 *  only the Coding Agent is served (lib/features.ts), which carries its own
 *  menu, wallet and network controls. */
export function AppShell({ children, bare = false }: { children: ReactNode; bare?: boolean }) {
  // Hydrate persisted deployments once on the client.
  const hydrate = useProjects((s) => s.hydrate);
  const openMobileNav = useUi((s) => s.openMobileNav);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const hydrateUi = useUi((s) => s.hydrate);
  // The Coding Agent has its own bar with its own menu (which also opens this
  // one), so on a phone it gets the whole screen rather than two bars.
  const fullScreen = useRouterState({
    select: (s) => s.location.pathname.startsWith("/launchkit/coding-agent"),
  });
  useEffect(() => {
    hydrate();
    hydrateUi();
  }, [hydrate, hydrateUi]);

  if (bare) {
    return (
      <div className="flex min-h-screen w-full flex-col bg-background text-foreground">
        <WrongNetworkBanner />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200",
          collapsed ? "md:pl-0" : "md:pl-60",
        )}
      >
        {/* Mobile top bar: the toggle opens the drawer */}
        <header
          className={cn(
            "flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 md:hidden",
            fullScreen && "hidden",
          )}
        >
          <button
            onClick={openMobileNav}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Open menu"
          >
            <PanelLeftOpen className="h-5 w-5" />
          </button>
          <Logo compact />
        </header>

        {/* Desktop: floating expand button, shown only when the rail is collapsed */}
        {collapsed && (
          <button
            onClick={toggleSidebar}
            className="fixed left-2 top-2 z-50 hidden rounded border border-border bg-surface p-1.5 text-muted-foreground shadow hover:text-foreground md:block"
            aria-label="Expand sidebar"
            title="Expand sidebar"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </button>
        )}

        <WrongNetworkBanner />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
