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
  Terminal,
  Copy,
  Check,
} from "lucide-react";
import { useState } from "react";
import { useWallet, truncateAddress } from "@/lib/wallet";
import { CHAIN, QIE_CHAIN_ID } from "@/lib/wallet";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Overview", icon: Home, exact: true },
  {
    section: "LaunchKit",
    items: [
      { to: "/launchkit/templates", label: "Templates", icon: Package },
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
  const [copied, setCopied] = useState(false);

  const copyAddr = () => {
    if (!wallet.address) return;
    navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to : path === to || path.startsWith(to + "/");

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface md:flex">
      {/* Brand */}
      <div className="border-b border-border px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-primary/15 text-primary">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="font-mono text-sm font-bold text-foreground">DevStation</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
              QIE Builder Console
            </div>
          </div>
        </div>
      </div>

      {/* Wallet */}
      <div className="border-b border-border px-4 py-3">
        {wallet.connected && wallet.address ? (
          <>
            <button
              onClick={copyAddr}
              className="group flex w-full items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-left transition hover:border-primary/50"
            >
              <span className="h-2 w-2 rounded-full bg-success" />
              <span className="font-mono text-xs text-foreground">
                {truncateAddress(wallet.address)}
              </span>
              {copied ? (
                <Check className="ml-auto h-3 w-3 text-success" />
              ) : (
                <Copy className="ml-auto h-3 w-3 text-meta group-hover:text-muted-foreground" />
              )}
            </button>
            <div className="mt-2 flex items-center gap-1.5">
              {wallet.qiePassVerified ? (
                <span className="font-mono text-[10px] text-success">✓ QIE Pass Verified</span>
              ) : (
                <span className="font-mono text-[10px] text-danger">✗ QIE Pass Required</span>
              )}
            </div>
          </>
        ) : (
          <button
            onClick={wallet.connect}
            className="w-full rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((entry, i) => {
          if ("section" in entry) {
            return (
              <div key={entry.section} className="mt-3 first:mt-0">
                <div className="px-2 pb-1 font-mono text-[10px] uppercase tracking-wider text-meta">
                  {entry.section}
                </div>
                {entry.items.map((item) => (
                  <SidebarLink
                    key={item.to}
                    {...item}
                    active={isActive(item.to)}
                  />
                ))}
              </div>
            );
          }
          return (
            <SidebarLink
              key={entry.to}
              to={entry.to}
              label={entry.label}
              icon={entry.icon}
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
              {CHAIN.name}{" "}
              <span className="text-meta">· {CHAIN.id}</span>
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
