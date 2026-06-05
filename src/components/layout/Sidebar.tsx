import { Link, useRouterState } from "@tanstack/react-router";
import {
  Home,
  Package,
  Rocket,
  FolderGit2,
  Search,
  Tags,
  Settings,
  BookOpen,
  Code2,
} from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { QIE_CHAIN_ID } from "@/lib/wallet";
import { CHAIN } from "@/lib/chain";
import { cn } from "@/lib/utils";
import { WalletPanel } from "@/components/web3/WalletPanel";
import { Logo } from "@/components/shared/Logo";

const NAV = [
  { to: "/", label: "Overview", icon: Home, exact: true },
  {
    section: "LaunchKit",
    items: [
      { to: "/launchkit/templates", label: "Templates", icon: Package },
      { to: "/launchkit/editor", label: "Contract Editor", icon: Code2 },
      { to: "/launchkit/deploy", label: "Deploy", icon: Rocket },
      { to: "/launchkit/projects", label: "Projects", icon: FolderGit2 },
    ],
  },
  {
    section: "Routebook",
    items: [
      { to: "/routebook", label: "Inspect Tx", icon: Search },
      { to: "/routebook/labels", label: "Label Registry", icon: Tags },
    ],
  },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const wallet = useWallet();
  const path = useRouterState({ select: (r) => r.location.pathname });

  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to : path === to || path.startsWith(to + "/");

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface md:flex">
      {/* Brand */}
      <div className="border-b border-border px-4 py-4">
        <Logo />
      </div>

      {/* Wallet */}
      <div className="border-b border-border px-4 py-3">
        <WalletPanel />
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((entry) => {
          if ("section" in entry && entry.section && entry.items) {
            return (
              <div key={entry.section} className="mt-3 first:mt-0">
                <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-meta">
                  {entry.section}
                </div>
                {entry.items.map((item) => (
                  <SidebarLink
                    key={item.to}
                    to={item.to}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.to)}
                  />
                ))}
              </div>
            );
          }
          if (!("to" in entry) || !entry.to) return null;
          return (
            <SidebarLink
              key={entry.to}
              to={entry.to}
              label={entry.label!}
              icon={entry.icon!}
              active={isActive(entry.to, entry.exact)}
            />
          );
        })}
        <a
          href="https://docs.qie.digital"
          target="_blank"
          rel="noreferrer"
          className="mt-1 flex items-center gap-2 rounded px-2 py-1.5 font-mono text-xs text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <BookOpen className="h-3.5 w-3.5" />
          Docs
        </a>
      </nav>

      {/* Footer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full",
              wallet.chainId === QIE_CHAIN_ID ? "bg-success" : "bg-danger",
            )}
          />
          {wallet.chainId === QIE_CHAIN_ID ? (
            <div className="font-mono text-[11px] text-foreground">
              {CHAIN.name} <span className="text-meta">· {CHAIN.id}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="text-danger">Wrong Network</span>
              <button onClick={wallet.switchToQIE} className="text-primary hover:underline">
                Switch
              </button>
            </div>
          )}
        </div>
        <div className="mt-1 font-mono text-[10px] text-meta">DevStation v1.0</div>
      </div>
    </aside>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2 rounded px-2 py-1.5 font-mono text-xs transition",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </Link>
  );
}
