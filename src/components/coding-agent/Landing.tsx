import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight, Bell, Ellipsis, Globe, Menu } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";
import { firstName, initials, useAuth } from "@/hooks/useAuth";
import type { AppProject } from "@/lib/appgen/projects";
import { APP_TEMPLATES, type AppTemplate } from "@/lib/coding-agent/app-templates";
import { CODING_AGENT_ONLY } from "@/lib/features";
import { ago } from "@/lib/coding-agent/steps";
import { greeting } from "@/lib/coding-agent/greeting";
import { cn } from "@/lib/utils";
import { Dropdown, MenuItem, RoundButton } from "./primitives";
import { ProjectThumb, RemoteThumb, TemplateThumb } from "./ProjectThumb";
import {
  templateSnapshot,
  useCommunityTemplates,
  type CommunityTemplate,
} from "@/lib/coding-agent/community-templates";

// The first screen, laid out the way Base44 opens: a greeting, one big prompt,
// and underneath it your work as large cards with a picture of each app, with
// a Templates tab beside it. The menu, the bell and your workspace sit in the
// bar along the top.

export type HomeTab = "recent" | "templates";

export function Landing({
  composer,
  below,
  projects,
  tab,
  onTab,
  onOpen,
  onRemix,
  onDelete,
  onTemplate,
  onCommunityTemplate,
  onMenu,
  onNews,
  onAccount,
  onSignIn,
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
  onTemplate: (t: AppTemplate) => void;
  onCommunityTemplate: (t: CommunityTemplate) => void;
  onMenu: () => void;
  onNews: () => void;
  onAccount: () => void;
  onSignIn: () => void;
  newsDot?: boolean;
  footer?: ReactNode;
}) {
  const account = useAuth((s) => s.account);
  const recent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  // Chosen in the browser, once per visit: the time of day is the visitor's,
  // and the server cannot know it (nor who is signed in).
  const [roll, setRoll] = useState<number | null>(null);
  useEffect(() => setRoll(Math.random()), []);
  const name = firstName(account);
  const hello = useMemo(
    () =>
      roll === null ? null : greeting(name, new Date(), { returning: projects.length > 0, roll }),
    // Picked again when the name arrives, not on every project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roll, name],
  );
  const community = useCommunityTemplates();

  return (
    <div data-agent-home className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 bg-background/85 px-3 py-2.5 backdrop-blur sm:px-5">
        <div>
          <RoundButton onClick={onMenu} label="Menu" icon={Menu} className="bg-transparent" />
        </div>
        <a href="/" className="flex items-center gap-2" aria-label="DevStation">
          <LogoMark className="h-7 w-7 sm:h-8 sm:w-8" />
          <span className="text-[18.5px] font-semibold tracking-tight text-foreground sm:text-[21.5px]">
            Dev<span className="text-primary">Station</span>
          </span>
        </a>
        <div className="flex items-center justify-end gap-2">
          <RoundButton
            onClick={onNews}
            label="Updates"
            icon={Bell}
            dot={newsDot}
            className="bg-transparent"
          />
          {account ? (
            <button
              onClick={onAccount}
              aria-label="Your account"
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-[13.5px] font-semibold text-foreground/85"
            >
              {initials(account)}
            </button>
          ) : (
            <button
              onClick={onSignIn}
              className="h-9 whitespace-nowrap rounded-full bg-foreground px-3.5 text-[13px] font-medium text-background hover:opacity-85"
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      <section className="mx-auto w-full max-w-3xl px-4 pb-10 pt-[6vh] sm:px-6">
        <h1
          className={cn(
            "text-center text-[33.5px] font-semibold leading-[1.1] tracking-tight text-foreground transition-opacity duration-500 sm:text-[47.5px]",
            hello ? "opacity-100" : "opacity-0",
          )}
        >
          {hello?.hello ?? "Hi there"}
          <span className="text-primary">{hello?.mark ?? "."}</span>
          <br />
          {hello?.ask ?? "What will you build next?"}
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
          {!CODING_AGENT_ONLY && (
            <>
              <Link
                to="/launchkit/marketplace"
                className="px-3 py-3.5 text-[14.5px] text-muted-foreground transition hover:text-foreground sm:px-4"
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
            </>
          )}
        </div>
      </div>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 sm:px-6">
        {tab === "recent" ? (
          recent.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border px-6 py-14 text-center">
              <p className="text-[15.5px] font-medium text-foreground">Nothing here yet</p>
              <p className="mx-auto mt-1 max-w-sm text-[13.5px] leading-6 text-muted-foreground">
                Describe something above, or start from a template. Every project you start shows up
                here with a picture of the app.
              </p>
              <button
                onClick={() => onTab("templates")}
                className="mt-4 rounded-full border border-border px-4 py-2 text-[13.5px] text-foreground hover:border-primary/50"
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
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {community.map((t) => (
              <TemplateCard
                key={t.id}
                name={t.name}
                blurb={t.blurb}
                badge="Community"
                onOpen={() => onCommunityTemplate(t)}
                picture={
                  <RemoteThumb
                    name={t.name}
                    cacheKey={`${t.id}:${t.version}`}
                    load={() => templateSnapshot(t)}
                  />
                }
              />
            ))}
            {APP_TEMPLATES.map((t) => (
              <TemplateCard
                key={t.id}
                name={t.name}
                blurb={t.blurb}
                onOpen={() => onTemplate(t)}
                picture={<TemplateThumb template={t} />}
              />
            ))}
          </div>
        )}
        {footer && <div className="mt-12 flex justify-center">{footer}</div>}
      </section>
    </div>
  );
}

function TemplateCard({
  name,
  blurb,
  badge,
  picture,
  onOpen,
}: {
  name: string;
  blurb: string;
  badge?: string;
  picture: ReactNode;
  onOpen: () => void;
}) {
  return (
    // A card, not a <button>: its picture is a live frame, which may not sit
    // inside a button.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`Open the ${name} template`}
    >
      <div className="relative overflow-hidden rounded-2xl border border-border transition group-hover:border-primary/40">
        {picture}
        {badge && (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-background/90 px-2 py-0.5 text-[11.5px] font-medium text-foreground shadow-sm backdrop-blur">
            {badge}
          </span>
        )}
        <span className="absolute bottom-2.5 right-2.5 flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[12px] font-medium text-foreground opacity-0 shadow-sm backdrop-blur transition group-hover:opacity-100">
          Open <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
      <p className="mt-3 text-[15.5px] font-semibold text-foreground">{name}</p>
      {blurb && <p className="mt-0.5 text-[13px] leading-5 text-muted-foreground">{blurb}</p>}
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
        "relative px-3 py-3.5 text-[14.5px] transition sm:px-4",
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
          <p className="flex items-center gap-2 text-[17.5px] font-semibold text-foreground">
            <span className="truncate">{project.name}</span>
            {project.liveUrl && <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />}
          </p>
          <p className="mt-0.5 truncate text-[13.5px] text-muted-foreground">
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
        <p className="text-[12.5px] text-meta">{ago(project.updatedAt)}</p>
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
