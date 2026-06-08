import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Menu, X, Terminal, ExternalLink } from "lucide-react";
import { DOC_NAV } from "@/components/docs/nav";

export const Route = createFileRoute("/docs")({
  head: () => ({ meta: [{ title: "Documentation - DevStation" }] }),
  component: DocsLayout,
});

function DocsLayout() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [navOpen, setNavOpen] = useState(false);

  // Close the mobile nav whenever the route changes.
  useEffect(() => {
    setNavOpen(false);
  }, [path]);

  return (
    <div className="mx-auto max-w-7xl">
      {/* Docs top bar with its own hamburger */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/90 px-4 py-3 backdrop-blur lg:px-6">
        <button
          onClick={() => setNavOpen(true)}
          className="flex items-center gap-2 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary lg:hidden"
          aria-label="Open documentation menu"
        >
          <Menu className="h-4 w-4" /> Docs menu
        </button>
        <div className="flex items-center gap-2 font-mono text-xs text-meta">
          <Terminal className="h-3.5 w-3.5 text-primary" />
          <Link to="/docs" className="text-primary hover:underline">
            devstation docs
          </Link>
        </div>
        <a
          href="https://devstation.online"
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
        >
          devstation.online <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="flex gap-8 px-4 py-8 lg:px-6">
        {/* Desktop sidebar nav */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20">
            <DocNavList path={path} />
          </div>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 pb-24">
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer */}
      {navOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="flex w-72 max-w-[85%] flex-col overflow-y-auto border-r border-border bg-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-foreground">Documentation</span>
              <button
                onClick={() => setNavOpen(false)}
                className="rounded p-1 text-meta hover:text-foreground"
                aria-label="Close documentation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <DocNavList path={path} />
          </div>
          <button
            className="flex-1 bg-background/60 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu overlay"
          />
        </div>
      )}
    </div>
  );
}

function DocNavList({ path }: { path: string }) {
  return (
    <nav className="space-y-4">
      {DOC_NAV.map((group) => (
        <div key={group.group}>
          <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-meta">
            {group.group}
          </div>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = path === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    "block rounded px-2 py-1.5 font-mono text-xs transition " +
                    (active
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
