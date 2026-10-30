import {
  Activity,
  CodeXml,
  Ellipsis,
  Eye,
  LoaderCircle,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Rocket,
  Users,
} from "lucide-react";
import type { AppProject } from "@/lib/appgen/projects";
import { cn } from "@/lib/utils";
import { RoundButton, Segmented, ghostButton, primaryButton } from "./primitives";

export type View = "preview" | "code" | "activity";

// The bar across a project. Round buttons at either end, as in both apps: the
// menu on the left, the project's options on the right, Publish beside them.
// On a larger screen it also carries Base44's Preview / Code switch; on a
// phone that job moves to the tab bar at the bottom.

export function TopBar({
  project,
  mobile,
  view,
  onView,
  fileCount,
  running,
  building,
  shared,
  canPublish,
  chatOpen,
  onToggleChat,
  onMenu,
  onMore,
  onShare,
  onPublish,
}: {
  project: AppProject;
  mobile: boolean;
  view: View;
  onView: (v: View) => void;
  fileCount: number;
  running: boolean;
  building: boolean;
  shared: boolean;
  canPublish: boolean;
  chatOpen: boolean;
  onToggleChat: () => void;
  onMenu: () => void;
  onMore: () => void;
  onShare: () => void;
  onPublish: () => void;
}) {
  const subtitle = running
    ? "Agent working…"
    : project.source?.repo
      ? `${project.source.repo}${project.source.ref ? ` @ ${project.source.ref}` : ""}`
      : `${fileCount} file${fileCount === 1 ? "" : "s"}${shared ? " · shared" : ""}`;

  if (mobile) {
    return (
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
        <RoundButton onClick={onMenu} label="Menu" icon={Menu} />
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[15px] font-semibold text-foreground">{project.name}</p>
          <p
            className={cn(
              "truncate text-[11.5px]",
              running ? "text-primary" : "text-muted-foreground",
            )}
          >
            {subtitle}
          </p>
        </div>
        <RoundButton onClick={onMore} label="Project options" icon={Ellipsis} />
        <button
          onClick={onPublish}
          disabled={!canPublish || running}
          aria-label={project.liveUrl ? "Update the live app" : "Publish"}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
        >
          <Rocket className="h-[18px] w-[18px]" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <RoundButton onClick={onMenu} label="Menu" icon={Menu} />
      <button
        onClick={onToggleChat}
        title={chatOpen ? "Hide the chat" : "Show the chat"}
        className={cn(ghostButton, "px-2")}
      >
        {chatOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
      </button>
      <div className="min-w-0 max-w-[18rem]">
        <p className="truncate text-[14.5px] font-semibold text-foreground">{project.name}</p>
        <p className={cn("truncate text-[11.5px]", running ? "text-primary" : "text-meta")}>
          {subtitle}
        </p>
      </div>

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
            { value: "code", label: "Code", icon: CodeXml },
            { value: "activity", label: "Activity", icon: Activity },
          ]}
        />
      </div>

      <button onClick={onShare} className={ghostButton} title="Invite builders">
        <Users className="h-4 w-4" />
        <span className="hidden lg:inline">Share</span>
      </button>
      <RoundButton onClick={onMore} label="Project options" icon={Ellipsis} />
      <button
        onClick={onPublish}
        disabled={!canPublish || running}
        className={cn(primaryButton, "ml-1 rounded-full px-4")}
        title={canPublish ? "Publish" : "There is no built web page to publish yet"}
      >
        <Rocket className="h-3.5 w-3.5" />
        {project.liveUrl ? "Update" : "Publish"}
      </button>
    </div>
  );
}

/** The phone's tab bar, Muse-style: icons only, the current one solid. */
export function TabBar({
  pane,
  onPane,
  onMore,
  building,
  running,
}: {
  pane: "chat" | View;
  onPane: (p: "chat" | View) => void;
  onMore: () => void;
  building: boolean;
  running: boolean;
}) {
  const items: {
    id: "chat" | View;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: "chat", label: "Chat", icon: MessageIcon },
    { id: "preview", label: "Preview", icon: Eye },
    { id: "code", label: "Code", icon: CodeXml },
    { id: "activity", label: "Activity", icon: Activity },
  ];
  return (
    <nav className="flex shrink-0 items-center justify-around border-t border-border bg-background px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      {items.map((it) => {
        const active = pane === it.id;
        const Icon = it.icon;
        const busy = (it.id === "preview" && building) || (it.id === "chat" && running && !active);
        return (
          <button
            key={it.id}
            onClick={() => onPane(it.id)}
            aria-label={it.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl transition",
              active ? "text-foreground" : "text-meta hover:text-muted-foreground",
            )}
          >
            <Icon
              className={cn("h-6 w-6", active && it.id === "chat" && "[&_path]:fill-current")}
            />
            <span className="text-[10px]">{it.label}</span>
            {busy && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-primary" />}
          </button>
        );
      })}
      <button
        onClick={onMore}
        aria-label="More"
        className="flex h-11 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-meta hover:text-muted-foreground"
      >
        <Menu className="h-6 w-6" />
        <span className="text-[10px]">More</span>
      </button>
    </nav>
  );
}

/** A speech bubble that can be drawn solid when its tab is open. */
function MessageIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      className={className}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}
