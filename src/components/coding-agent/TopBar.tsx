import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Activity,
  Check,
  ChevronDown,
  CodeXml,
  Download,
  Ellipsis,
  Eye,
  GitFork,
  Github,
  GitPullRequest,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Rocket,
  Search,
  Sparkles,
  Store,
  Terminal,
  Users,
} from "lucide-react";
import type { AppProject } from "@/lib/appgen/projects";
import { ago } from "@/lib/coding-agent/steps";
import { docsHref } from "@/lib/site-hosts";
import { cn } from "@/lib/utils";
import { Dropdown, MenuItem, MenuLabel, Segmented, ghostButton, primaryButton } from "./primitives";

export type View = "preview" | "code" | "activity";

// One bar across the top, the way Lovable and Base44 lay out a project: the
// project (and every other one) on the left, what you are looking at in the
// middle, and what you can do with it on the right, Publish first.

export function TopBar({
  project,
  projects,
  onOpen,
  onNew,
  onRename,
  view,
  onView,
  fileCount,
  running,
  building,
  shared,
  canPublish,
  hasRepo,
  canPullRequest,
  onShare,
  onPush,
  onPullRequest,
  onPublish,
  onDownload,
  onRemix,
  chatOpen,
  onToggleChat,
}: {
  project: AppProject;
  projects: AppProject[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (name: string) => void;
  view: View;
  onView: (v: View) => void;
  fileCount: number;
  running: boolean;
  building: boolean;
  shared: boolean;
  canPublish: boolean;
  hasRepo: boolean;
  canPullRequest: boolean;
  onShare: () => void;
  onPush: () => void;
  onPullRequest: () => void;
  onPublish: () => void;
  onDownload: () => void;
  onRemix: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-2 sm:px-3">
      <button
        onClick={onToggleChat}
        title={chatOpen ? "Hide the chat" : "Show the chat"}
        className={cn(ghostButton, "hidden px-1.5 md:inline-flex")}
      >
        {chatOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
      </button>
      <ProjectSwitcher
        project={project}
        projects={projects}
        onOpen={onOpen}
        onNew={onNew}
        onRename={onRename}
        running={running}
        shared={shared}
      />

      <div className="flex flex-1 justify-center">
        <Segmented
          value={view}
          onChange={onView}
          options={[
            {
              value: "preview",
              label: "Preview",
              icon: Eye,
              badge: building ? (
                <LoaderCircle className="h-3 w-3 animate-spin text-primary" />
              ) : undefined,
            },
            {
              value: "code",
              label: "Code",
              icon: CodeXml,
              badge: fileCount ? (
                <span className="hidden font-mono text-[10px] text-meta lg:inline">
                  {fileCount}
                </span>
              ) : undefined,
            },
            { value: "activity", label: "Activity", icon: Activity },
          ]}
        />
      </div>

      <div className="flex items-center gap-1">
        <button onClick={onShare} className={cn(ghostButton, "max-md:hidden")} title="Share">
          <Users className="h-3.5 w-3.5" />
          <span className="hidden lg:inline">Share</span>
        </button>
        <Dropdown
          label="GitHub"
          align="right"
          triggerClassName={cn(ghostButton, "max-md:hidden")}
          trigger={() => (
            <>
              <Github className="h-3.5 w-3.5" />
              <span className="hidden lg:inline">GitHub</span>
              <ChevronDown className="h-3 w-3 text-meta" />
            </>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                icon={Github}
                disabled={!fileCount || running}
                onClick={() => {
                  close();
                  onPush();
                }}
              >
                Push to a new repository
              </MenuItem>
              {hasRepo && (
                <MenuItem
                  icon={GitPullRequest}
                  disabled={!canPullRequest || running}
                  onClick={() => {
                    close();
                    onPullRequest();
                  }}
                >
                  Open a pull request
                </MenuItem>
              )}
            </>
          )}
        </Dropdown>
        <Dropdown
          label="More"
          align="right"
          triggerClassName={ghostButton}
          trigger={() => <Ellipsis className="h-4 w-4" />}
        >
          {(close) => (
            <>
              <div className="md:hidden">
                <MenuItem
                  icon={Users}
                  onClick={() => {
                    close();
                    onShare();
                  }}
                >
                  Share
                </MenuItem>
                <MenuItem
                  icon={Github}
                  disabled={!fileCount || running}
                  onClick={() => {
                    close();
                    onPush();
                  }}
                >
                  Push to GitHub
                </MenuItem>
                {hasRepo && (
                  <MenuItem
                    icon={GitPullRequest}
                    disabled={!canPullRequest || running}
                    onClick={() => {
                      close();
                      onPullRequest();
                    }}
                  >
                    Open a pull request
                  </MenuItem>
                )}
              </div>
              <MenuItem
                icon={Download}
                disabled={!fileCount}
                onClick={() => {
                  close();
                  onDownload();
                }}
              >
                Download as zip
              </MenuItem>
              <MenuItem
                icon={GitFork}
                onClick={() => {
                  close();
                  onRemix();
                }}
              >
                Remix into a copy
              </MenuItem>
              <Link
                to="/launchkit/marketplace/sell"
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-foreground hover:bg-surface-2"
              >
                <Store className="h-3.5 w-3.5 text-muted-foreground" /> Sell on the marketplace
              </Link>
              <a
                href={docsHref("/docs/cli/install")}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-foreground hover:bg-surface-2"
              >
                <Terminal className="h-3.5 w-3.5 text-muted-foreground" /> Same agent in your
                terminal
              </a>
            </>
          )}
        </Dropdown>
        <button
          onClick={onPublish}
          disabled={!canPublish || running}
          className={cn(primaryButton, "ml-1")}
          title={canPublish ? "Publish" : "There is no built web page to publish yet"}
        >
          <Rocket className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{project.liveUrl ? "Update" : "Publish"}</span>
        </button>
      </div>
    </div>
  );
}

function ProjectSwitcher({
  project,
  projects,
  onOpen,
  onNew,
  onRename,
  running,
  shared,
}: {
  project: AppProject;
  projects: AppProject[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onRename: (name: string) => void;
  running: boolean;
  shared: boolean;
}) {
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const q = query.trim().toLowerCase();
  const shown = q ? sorted.filter((p) => p.name.toLowerCase().includes(q)) : sorted.slice(0, 12);

  if (renaming !== null) {
    return (
      <form
        className="flex min-w-0 items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (renaming.trim()) onRename(renaming.trim().slice(0, 80));
          setRenaming(null);
        }}
      >
        <input
          autoFocus
          value={renaming}
          onChange={(e) => setRenaming(e.target.value)}
          onBlur={() => setRenaming(null)}
          onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
          className="w-44 rounded-md border border-primary bg-background px-2 py-1 text-[13px] text-foreground focus:outline-none"
        />
        <button
          type="submit"
          onMouseDown={(e) => e.preventDefault()}
          className="rounded p-1 text-primary"
          aria-label="Save name"
        >
          <Check className="h-4 w-4" />
        </button>
      </form>
    );
  }

  return (
    <Dropdown
      label="Projects"
      className="w-72"
      triggerClassName="flex min-w-0 max-w-[42vw] items-center gap-2 rounded-md px-1.5 py-1 text-left transition hover:bg-surface-2 sm:max-w-[16rem]"
      trigger={(open) => (
        <>
          <span
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary",
              running && "animate-pulse",
            )}
          >
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground">
              {project.name}
            </span>
            <span className="hidden truncate font-mono text-[10px] text-meta sm:block">
              {running
                ? "Agent working…"
                : project.source?.repo
                  ? `${project.source.repo}${project.source.ref ? ` @ ${project.source.ref}` : ""}`
                  : `${Object.keys(project.files).length} files${shared ? " · shared" : ""}`}
            </span>
          </span>
          <ChevronDown
            className={cn("h-3.5 w-3.5 shrink-0 text-meta transition", open && "rotate-180")}
          />
        </>
      )}
    >
      {(close) => (
        <>
          <MenuItem
            icon={Plus}
            onClick={() => {
              close();
              onNew();
            }}
          >
            New project
          </MenuItem>
          <MenuItem
            icon={Pencil}
            onClick={() => {
              close();
              setRenaming(project.name);
            }}
          >
            Rename this project
          </MenuItem>
          <div className="my-1 border-t border-border" />
          {projects.length > 6 && (
            <div className="mx-1 mb-1 flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
              <Search className="h-3 w-3 text-meta" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a project"
                className="min-w-0 flex-1 bg-transparent text-[12px] focus:outline-none"
              />
            </div>
          )}
          <MenuLabel>Recent</MenuLabel>
          <div className="max-h-72 overflow-y-auto">
            {shown.map((p) => (
              <MenuItem
                key={p.id}
                onClick={() => {
                  close();
                  onOpen(p.id);
                }}
                hint={
                  p.id === project.id ? (
                    <Check className="h-3 w-3 text-primary" />
                  ) : (
                    ago(p.updatedAt)
                  )
                }
              >
                {p.name}
              </MenuItem>
            ))}
            {shown.length === 0 && <p className="px-2.5 py-1.5 text-[12px] text-meta">None.</p>}
          </div>
        </>
      )}
    </Dropdown>
  );
}
