import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Bell,
  BookOpen,
  ChevronDown,
  ChevronsUpDown,
  LayoutGrid,
  LayoutTemplate,
  MessagesSquare,
  Plus,
  Search,
  Store,
  Terminal,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { initials, useAuth } from "@/hooks/useAuth";
import type { AppProject } from "@/lib/appgen/projects";
import { ago } from "@/lib/coding-agent/steps";
import { docsHref } from "@/lib/site-hosts";
import { useUi } from "@/lib/ui-state";
import { CODING_AGENT_ONLY } from "@/lib/features";
import { cn } from "@/lib/utils";
import { Drawer } from "./primitives";

// The menu behind the hamburger. Its bones are Base44's (New, your apps,
// Explore, the workspace at the bottom); the list itself reads like Muse's
// chat drawer: a search pill on top and one quiet row per conversation, with
// how long ago it moved.

export function AppDrawer({
  projects,
  activeId,
  onOpen,
  onNew,
  onTemplates,
  onAccount,
  onNews,
  newsDot,
  onClose,
}: {
  projects: AppProject[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
  onTemplates: () => void;
  onAccount: () => void;
  onNews: () => void;
  newsDot?: boolean;
  onClose: () => void;
}) {
  const openAppMenu = useUi((s) => s.openMobileNav);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(true);
  const q = query.trim().toLowerCase();
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const shown = q ? sorted.filter((p) => p.name.toLowerCase().includes(q)) : sorted;

  const go = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <Drawer onClose={onClose}>
      <div className="flex items-center gap-2 px-4 pb-2 pt-4">
        <LogoMark className="h-8 w-8" />
        <p className="flex-1 text-[18px] font-semibold tracking-tight text-foreground">
          Dev<span className="text-primary">Station</span>
        </p>
        <button
          onClick={onClose}
          aria-label="Close menu"
          className="rounded-full p-1.5 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3.5 py-2">
          <Search className="h-4 w-4 shrink-0 text-meta" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground placeholder:text-meta focus:outline-none"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <button
          onClick={go(onNew)}
          className="mb-1 flex w-full items-center gap-3 rounded-xl bg-surface-2 px-3 py-2.5 text-left text-[15px] font-medium text-foreground transition hover:bg-border/70"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-foreground text-background">
            <Plus className="h-4 w-4" />
          </span>
          New project
        </button>

        <button
          onClick={() => setOpen((v) => !v)}
          className="mt-3 flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-muted-foreground"
        >
          <span className="flex-1 text-left">Projects</span>
          <span className="font-mono text-[11px] text-meta">{projects.length}</span>
          <ChevronDown className={cn("h-4 w-4 transition", !open && "-rotate-90")} />
        </button>
        {open &&
          (projects.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <MessagesSquare className="mx-auto h-8 w-8 text-meta" />
              <p className="mt-2 text-[14px] font-medium text-foreground">Start a project</p>
              <p className="mt-1 text-[12.5px] leading-5 text-muted-foreground">
                Each project is one conversation with the agent, its files and its preview.
              </p>
            </div>
          ) : shown.length === 0 ? (
            <p className="px-3 py-2 text-[13px] text-meta">No project matches.</p>
          ) : (
            <ul className="space-y-0.5">
              {shown.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={go(() => onOpen(p.id))}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition",
                      p.id === activeId
                        ? "bg-surface-2 text-foreground"
                        : "text-foreground/85 hover:bg-surface-2/60",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[14.5px]">{p.name}</span>
                    <span className="shrink-0 text-[12px] text-meta">{ago(p.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ))}

        <p className="mt-5 px-3 pb-1 text-[13px] text-muted-foreground">Explore</p>
        {/* On a phone the app's own menu bar is hidden on this page; this
            opens it. A larger screen always shows the app's sidebar. */}
        <div className={cn("md:hidden", CODING_AGENT_ONLY && "hidden")}>
          <DrawerLink icon={LayoutGrid} onClick={go(openAppMenu)}>
            DevStation menu
          </DrawerLink>
        </div>
        <DrawerLink icon={LayoutTemplate} onClick={go(onTemplates)}>
          Templates
        </DrawerLink>
        {!CODING_AGENT_ONLY && (
          <Link
            to="/launchkit/marketplace"
            onClick={onClose}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] text-foreground/85 hover:bg-surface-2/60"
          >
            <Store className="h-[18px] w-[18px] text-muted-foreground" /> Marketplace
          </Link>
        )}
        <a
          href={docsHref("/docs/coding-agent")}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] text-foreground/85 hover:bg-surface-2/60"
        >
          <BookOpen className="h-[18px] w-[18px] text-muted-foreground" /> How it works
        </a>

        <a
          href={docsHref("/docs/cli/install")}
          className="mt-5 block rounded-2xl border border-border p-4 transition hover:border-primary/40"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-medium text-foreground">
              Same agent, your terminal
            </span>
            <Terminal className="h-4 w-4 text-primary" />
          </span>
          <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">
            Install the DevStation CLI and keep working on your own machine.
          </span>
        </a>
      </div>

      <WorkspaceRow
        onAccount={go(onAccount)}
        onNews={go(onNews)}
        newsDot={newsDot}
        count={projects.length}
      />
    </Drawer>
  );
}

function DrawerLink({
  icon: Icon,
  children,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14.5px] text-foreground/85 hover:bg-surface-2/60"
    >
      <Icon className="h-[18px] w-[18px] text-muted-foreground" /> {children}
    </button>
  );
}

/** Your account, at the foot of the drawer. */
function WorkspaceRow({
  onAccount,
  onNews,
  newsDot,
  count,
}: {
  onAccount: () => void;
  onNews: () => void;
  newsDot?: boolean;
  count: number;
}) {
  const account = useAuth((s) => s.account);
  return (
    <div className="flex items-center gap-2 border-t border-border p-3">
      <button
        onClick={onAccount}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left hover:bg-surface-2"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[14px] font-semibold text-foreground/85">
          {account ? initials(account) : "DS"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14.5px] font-medium text-foreground">
            {account
              ? `${account.name ?? account.email.split("@")[0]}'s Workspace`
              : "Your workspace"}
          </span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            {account
              ? `${count} project${count === 1 ? "" : "s"} · ${account.email}`
              : "Not signed in"}
          </span>
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-meta" />
      </button>
      <button
        onClick={onNews}
        aria-label="Updates"
        className="relative rounded-full p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      >
        <Bell className="h-5 w-5" />
        {newsDot && (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-surface" />
        )}
      </button>
    </div>
  );
}
