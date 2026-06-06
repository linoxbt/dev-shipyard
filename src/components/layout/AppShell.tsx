import { ReactNode, useEffect } from "react";
import { Menu } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { WrongNetworkBanner } from "./WrongNetworkBanner";
import { useProjects } from "@/lib/mock/projects";
import { useUi } from "@/lib/ui-state";
import { Logo } from "@/components/shared/Logo";

export function AppShell({ children }: { children: ReactNode }) {
  // Hydrate persisted deployments once on the client.
  const hydrate = useProjects((s) => s.hydrate);
  const openMobileNav = useUi((s) => s.openMobileNav);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        {/* Mobile top bar with hamburger */}
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 md:hidden">
          <button
            onClick={openMobileNav}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <Logo compact />
        </header>
        <WrongNetworkBanner />
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
