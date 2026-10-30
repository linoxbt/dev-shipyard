import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  Coins,
  Ellipsis,
  Gamepad2,
  Globe,
  Image,
  LayoutDashboard,
  Menu,
  Server,
  Users,
} from "lucide-react";
import { useAccount } from "wagmi";
import { Identicon } from "@/components/builder/BuilderName";
import { useQieName } from "@/hooks/useQieIdentity";
import type { AppProject } from "@/lib/appgen/projects";
import { IDEAS, type IdeaKind } from "@/lib/coding-agent/ideas";
import { ago } from "@/lib/coding-agent/steps";
import { cn } from "@/lib/utils";
import { Dropdown, MenuItem, RoundButton } from "./primitives";
import { ProjectThumb } from "./ProjectThumb";

// The first screen, laid out the way Base44 opens: a greeting, one big prompt,
// and underneath it your work as large cards with a picture of each app, with
// a Templates tab beside it. The menu, the bell and your workspace sit in the
// bar along the top.

export type HomeTab = "recent" | "templates";

const KIND_ICON: Record<IdeaKind, React.ComponentType<{ className?: string }>> = {
  community: Users,
  token: Coins,
  api: Server,
  nft: Image,
  dashboard: LayoutDashboard,
  game: Gamepad2,
};

const KIND_TINT: Record<IdeaKind, string> = {
  community: "from-primary/60 via-primary/20",
  token: "from-warning/60 via-warning/15",
  api: "from-info/60 via-info/15",
  nft: "from-cat-nft/60 via-cat-nft/15",
  dashboard: "from-success/50 via-success/15",
  game: "from-cat-gov/60 via-cat-gov/15",
};

export function Landing({
  composer,
  below,
  projects,
  tab,
  onTab,
  onOpen,
  onRemix,
  onDelete,
  onIdea,
  onMenu,
  onNews,
  onAccount,
  newsDot,
  footer,
}: {
  composer: ReactNode;
  below?: ReactNode;
  projects: AppProject[];
  tab: HomeTab;
  onTab: (t: HomeTab) => void;
  onOpen: (id: string) => void;
  onRemix: (id: string) => void;
  onDelete: (id: string) => void;
  onIdea: (prompt: string) => void;
  onMenu: () => void;
  onNews: () => void;
  onAccount: () => void;
  newsDot?: boolean;
  footer?: ReactNode;
}) {
  const { address } = useAccount();
  const name = useQieName(address);
  const recent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div data-agent-home className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-background/85 px-3 py-2.5 backdrop-blur sm:px-5">
        <RoundButton onClick={onMenu} label="Menu" icon={Menu} className="bg-transparent" />
        <div className="flex-1" />
        <RoundButton
          onClick={onNews}
          label="Updates"
          icon={Bell}
          dot={newsDot}
          className="bg-transparent"
        />
        <button
          onClick={onAccount}
          aria-label="Your workspace"
          className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-surface-2 text-[12px] font-semibold text-muted-foreground"
        >
          {address ? <Identicon address={address} size={36} className="rounded-xl ring-0" /> : "DS"}
        </button>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 pb-10 pt-[6vh] sm:px-6">
        <h1 className="text-center text-[34px] font-semibold leading-[1.1] tracking-tight text-foreground sm:text-5xl">
          Hi {name?.label ?? "there"}
          <span className="text-primary">.</span>
          <br />
          What will you build next?
        </h1>
        <div className="mt-9">{composer}</div>
        {below && <div className="mt-2">{below}</div>}
      </section>

      <div className="border-y border-border">
        <div className="mx-auto flex w-full max-w-6xl items-center px-4 sm:px-6">
          <TabButton active={tab === "recent"} onClick={() => onTab("recent")}>
            Recent
          </TabButton>
          <TabButton active={tab === "templates"} onClick={() => onTab("templates")}>
            Templates
          </TabButton>
          <Link
            to="/launchkit/marketplace"
            className="px-3 py-3.5 text-[15px] text-muted-foreground transition hover:text-foreground sm:px-4"
          >
            Marketplace
          </Link>
          <Link
            to="/launchkit/marketplace"
            aria-label="Open the marketplace"
            className="ml-auto rounded-full p-2 text-muted-foreground hover:text-foreground"
          >
            <ArrowUpRight className="h-5 w-5" />
          </Link>
        </div>
      </div>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        {tab === "recent" ? (
          recent.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border px-6 py-14 text-center">
              <p className="text-[16px] font-medium text-foreground">Nothing here yet</p>
              <p className="mx-auto mt-1 max-w-sm text-[14px] leading-6 text-muted-foreground">
                Describe something above, or start from a template. Every project you start shows up
                here with a picture of the app.
              </p>
              <button
                onClick={() => onTab("templates")}
                className="mt-4 rounded-full border border-border px-4 py-2 text-[14px] text-foreground hover:border-primary/50"
              >
                Browse templates
              </button>
            </div>
          ) : (
            <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  onOpen={() => onOpen(p.id)}
                  onRemix={() => onRemix(p.id)}
                  onDelete={() => onDelete(p.id)}
                />
              ))}
            </div>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {IDEAS.map((idea) => {
              const Icon = KIND_ICON[idea.kind];
              return (
                <button
                  key={idea.label}
                  onClick={() => onIdea(idea.prompt)}
                  className="group overflow-hidden rounded-2xl border border-border bg-surface text-left transition hover:border-primary/40"
                >
                  <div
                    className={cn(
                      "relative flex aspect-[16/9] items-center justify-center bg-gradient-to-br to-transparent",
                      KIND_TINT[idea.kind],
                    )}
                  >
                    <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-background/80 text-foreground shadow-lg backdrop-blur transition group-hover:scale-105">
                      <Icon className="h-6 w-6" />
                    </span>
                  </div>
                  <div className="p-4">
                    <p className="text-[16px] font-semibold text-foreground">{idea.label}</p>
                    <p className="mt-1 text-[13.5px] leading-5 text-muted-foreground">
                      {idea.blurb}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {footer && <div className="mt-12 flex justify-center">{footer}</div>}
      </section>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative px-3 py-3.5 text-[15px] transition sm:px-4",
        active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />}
    </button>
  );
}

function ProjectCard({
  project,
  onOpen,
  onRemix,
  onDelete,
}: {
  project: AppProject;
  onOpen: () => void;
  onRemix: () => void;
  onDelete: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div>
      <button
        onClick={onOpen}
        className="block w-full overflow-hidden rounded-2xl border border-border transition hover:border-primary/40"
      >
        <ProjectThumb project={project} />
      </button>
      <div className="mt-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[18px] font-semibold text-foreground">
            <span className="truncate">{project.name}</span>
            {project.liveUrl && <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </p>
          <p className="mt-0.5 truncate text-[14px] text-muted-foreground">
            {project.role === "builder" || project.shared
              ? "Shared with you"
              : project.source?.repo
                ? `from ${project.source.repo}`
                : "by you"}
          </p>
        </div>
        <Dropdown
          label="Project options"
          align="right"
          triggerClassName="rounded-full p-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          trigger={() => <Ellipsis className="h-5 w-5" />}
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close();
                  onOpen();
                }}
              >
                Open
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close();
                  onRemix();
                }}
              >
                Remix into a copy
              </MenuItem>
              <MenuItem
                danger
                onClick={() => {
                  if (!confirm) return setConfirm(true);
                  close();
                  onDelete();
                }}
              >
                {confirm ? "Tap again to delete" : "Delete"}
              </MenuItem>
            </>
          )}
        </Dropdown>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[13px] text-meta">{ago(project.updatedAt)}</p>
        <button
          onClick={onOpen}
          aria-label={`Open ${project.name}`}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-foreground text-background transition hover:opacity-85"
        >
          <ArrowRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
