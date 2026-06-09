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
  Sparkles,
  Compass,
  Activity,
  Sun,
  Moon,
  PanelLeftClose,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { WalletPanel } from "@/components/web3/WalletPanel";
import { NetworkSelector } from "@/components/web3/NetworkSelector";
import { Logo } from "@/components/shared/Logo";
import { useUi } from "@/lib/ui-state";
import { useTheme } from "@/lib/theme";

const NAV = [
  { to: "/overview", label: "Overview", icon: Home, exact: true },
  { to: "/explorer", label: "QIE Explorer", icon: Compass },
  { to: "/activity", label: "Activity", icon: Activity },
  {
    section: "LaunchKit",
    items: [
      { to: "/launchkit/templates", label: "Templates", icon: Package },
      { to: "/launchkit/editor", label: "Contract Editor", icon: Code2 },
      { to: "/launchkit/ai", label: "Code with AI", icon: Sparkles },
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
  {
    section: "General",
    items: [
      { to: "/settings", label: "Settings", icon: Settings },
      { to: "/docs", label: "Docs", icon: BookOpen },
    ],
  },
];

// The sidebar content, shared by the desktop fixed rail and the mobile drawer.
function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to : path === to || path.startsWith(to + "/");

  return (
    <>
      <div className="flex items-center justify-between border-b border-border px-4 py-4">
        <Logo />
        {/* Desktop: collapse the rail. Mobile: close the drawer. */}
        <button
          onClick={onNavigate ?? toggleSidebar}
          className="rounded p-1 text-meta hover:text-foreground"
          aria-label={onNavigate ? "Close menu" : "Collapse sidebar"}
          title={onNavigate ? "Close menu" : "Collapse sidebar"}
        >
          {onNavigate ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-border px-4 py-3">
        <WalletPanel />
      </div>

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
                    onClick={onNavigate}
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
              onClick={onNavigate}
            />
          );
        })}
      </nav>

      <div className="border-t border-border px-4 py-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">Network</div>
        <NetworkSelector />
        <div className="mt-2 flex items-center justify-between">
          <span className="font-mono text-[10px] text-meta">DevStation v1.0</span>
          <ThemeButton />
        </div>
      </div>
    </>
  );
}

export function Sidebar() {
  const { mobileNavOpen, closeMobileNav, sidebarCollapsed } = useUi();

  return (
    <>
      {/* Desktop fixed rail — hidden when collapsed */}
      {!sidebarCollapsed && (
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-border bg-surface md:flex">
          <SidebarContent />
        </aside>
      )}

      {/* Mobile drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="flex w-72 max-w-[85%] flex-col border-r border-border bg-surface">
            <SidebarContent onNavigate={closeMobileNav} />
          </div>
          <button
            className="flex-1 bg-background/60 backdrop-blur-sm"
            onClick={closeMobileNav}
            aria-label="Close menu overlay"
          />
        </div>
      )}
    </>
  );
}

function SidebarLink({
  to,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onClick}
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

// Compact dark/light toggle for the sidebar footer.
function ThemeButton() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  return (
    <button
      onClick={toggle}
      className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] text-meta hover:border-primary hover:text-primary"
      title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      aria-label="Toggle theme"
    >
      {theme === "dark" ? <Sun className="h-3 w-3" /> : <Moon className="h-3 w-3" />}
      {theme === "dark" ? "Light" : "Dark"}
    </button>
  );
}
