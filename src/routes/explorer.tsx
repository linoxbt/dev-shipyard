import { createFileRoute, Outlet, Link, useRouterState } from "@tanstack/react-router";
import { Compass, ExternalLink } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { qieTestnet, qieMainnet } from "@/lib/chains";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/explorer")({
  head: () => ({ meta: [{ title: "QIE Explorer - DevStation" }] }),
  component: ExplorerLayout,
});

function ExplorerLayout() {
  const { chain, config, select } = useActiveChain();
  const path = useRouterState({ select: (r) => r.location.pathname });
  const onHome = path === "/explorer";

  return (
    <div>
      {/* Explorer header: brand, network switch, external link */}
      <div className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 lg:px-6">
          <Link
            to="/explorer"
            className="flex items-center gap-2 font-mono text-sm font-bold text-foreground"
          >
            <Compass className="h-4 w-4 text-primary" /> QIE Explorer
          </Link>

          <div className="inline-flex rounded border border-border bg-surface p-0.5">
            {[qieTestnet, qieMainnet].map((c) => {
              const active = chain.id === c.id;
              return (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[11px] transition",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", c.testnet ? "bg-warning" : "bg-info")}
                  />
                  {c.testnet ? "Testnet" : "Mainnet"}
                </button>
              );
            })}
          </div>

          {!onHome && (
            <Link to="/explorer" className="font-mono text-[11px] text-primary hover:underline">
              ← Dashboard
            </Link>
          )}

          <a
            href={config.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
          >
            Official explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="p-4 lg:p-6">
        <Outlet />
      </div>
    </div>
  );
}
