import { ReactNode, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { WrongNetworkBanner } from "./WrongNetworkBanner";
import { useProjects } from "@/lib/mock/projects";

export function AppShell({ children }: { children: ReactNode }) {
  // Hydrate persisted deployments once on the client.
  const hydrate = useProjects((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-1 flex-col min-w-0 md:pl-60">
        <WrongNetworkBanner />
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
