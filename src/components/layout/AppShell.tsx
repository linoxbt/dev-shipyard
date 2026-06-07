import { ReactNode, useEffect } from "react";
import { PanelLeftOpen } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { WrongNetworkBanner } from "./WrongNetworkBanner";
import { MainnetWarningBanner } from "./MainnetWarningBanner";
import { useProjects } from "@/lib/mock/projects";
import { useUi } from "@/lib/ui-state";
import { Logo } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";

export function AppShell({ children }: { children: ReactNode }) {
  // Hydrate persisted deployments once on the client.
  const hydrate = useProjects((s) => s.hydrate);
  const openMobileNav = useUi((s) => s.openMobileNav);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const collapsed = useUi((s) => s.sidebarCollapsed);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div
        className={cn(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200",
          collapsed ? "md:pl-0" : "md:pl-60",
        )}
      >
        {/* Mobile top bar — the toggle opens the drawer */}
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 md:hidden">
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

        <MainnetWarningBanner />
        <WrongNetworkBanner />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
