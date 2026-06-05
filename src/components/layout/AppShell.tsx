import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { WrongNetworkBanner } from "./WrongNetworkBanner";

export function AppShell({ children }: { children: ReactNode }) {
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
