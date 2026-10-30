import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  BookOpen,
  Cookie,
  Download,
  ExternalLink,
  GitFork,
  Github,
  GitPullRequest,
  LifeBuoy,
  LogOut,
  Moon,
  Pencil,
  Rocket,
  Settings,
  Store,
  Sun,
  Terminal,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import { CODING_AGENT_ONLY, servedInAgentOnly } from "@/lib/features";
import { useTheme } from "@/lib/theme";
import { initials, useAuth } from "@/hooks/useAuth";
import { useConsent } from "@/lib/consent";
import type { AppProject } from "@/lib/appgen/projects";
import { ago } from "@/lib/coding-agent/steps";
import { docsHref } from "@/lib/site-hosts";
import { cn } from "@/lib/utils";
import { Modal, Segmented, SheetRow } from "./primitives";

// The sheets that slide up from the bottom: the workspace (Base44's
// workspace-and-credits sheet, with real numbers in place of credits), the
// updates panel (Base44's notifications / latest news), and the project's
// settings list (Muse's settings sheet: one row per thing, a chevron each).

/** Projects the browser keeps, from lib/appgen/projects.ts. */
const MAX_PROJECTS = 40;
/** What browsers give one site in localStorage, in UTF-16 characters. */
const STORAGE_CHARS = 5 * 1024 * 1024;

function storageUsed(): number {
  try {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) ?? "";
      chars += key.length + (localStorage.getItem(key)?.length ?? 0);
    }
    return chars;
  } catch {
    return 0;
  }
}

function Meter({
  label,
  value,
  max,
  text,
}: {
  label: string;
  value: number;
  max: number;
  text: string;
}) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13.5px] text-foreground">{label}</span>
        <span className="font-mono text-[11.5px] text-muted-foreground">{text}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border">
        <div
          className={cn("h-full rounded-full", pct > 85 ? "bg-danger" : "bg-primary")}
          style={{ width: `${Math.max(pct, value > 0 ? 3 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function AccountSheet({
  projects,
  usage,
  onSignIn,
  onEditName,
  onClose,
}: {
  projects: AppProject[];
  /** The open project's agent work, when one is open. */
  usage?: { steps: number; costUsd: number } | null;
  onSignIn: () => void;
  onEditName: () => void;
  onClose: () => void;
}) {
  const account = useAuth((s) => s.account);
  const updateProfile = useAuth((s) => s.updateProfile);
  const signOut = useAuth((s) => s.signOut);
  const manageCookies = useConsent((s) => s.manage);
  const theme = useTheme((s) => s.theme);
  const toggleTheme = useTheme((s) => s.toggle);
  const [used, setUsed] = useState(0);
  useEffect(() => setUsed(storageUsed()), []);

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center gap-3 border-b border-border pb-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-[15px] font-semibold text-foreground/85">
          {account ? initials(account) : "DS"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15.5px] font-semibold text-foreground">
            {account
              ? `${account.name ?? account.email.split("@")[0]}'s Workspace`
              : "Your workspace"}
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {plural(projects.length, "project")} · {account ? account.email : "not signed in"}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-background px-4 py-1">
        <Meter
          label="Projects saved"
          value={projects.length}
          max={MAX_PROJECTS}
          text={`${projects.length}/${MAX_PROJECTS}`}
        />
        <div className="border-t border-border" />
        <Meter
          label="Browser storage"
          value={used}
          max={STORAGE_CHARS}
          text={`${(used / 1024 / 1024).toFixed(1)}/5 MB`}
        />
        {usage && usage.steps > 0 && (
          <>
            <div className="border-t border-border" />
            <div className="flex items-center justify-between py-3">
              <span className="text-[13.5px] text-foreground">This project</span>
              <span className="font-mono text-[11.5px] text-muted-foreground">
                {usage.steps} steps · ~${usage.costUsd.toFixed(2)}
              </span>
            </div>
          </>
        )}
      </div>
      <p className="mt-2 px-1 text-[11px] leading-5 text-meta">
        Projects live in this browser. Push to GitHub or download one to keep a copy elsewhere.
      </p>

      {!account && (
        <button
          onClick={() => {
            onClose();
            onSignIn();
          }}
          className="mt-4 w-full rounded-xl border border-primary py-2.5 text-[14px] font-medium text-primary transition hover:bg-primary/10"
        >
          Sign in or create an account
        </button>
      )}

      <p className="mt-5 px-2 text-[12px] text-muted-foreground">Workspace</p>
      {account && (
        <SheetRow
          icon={UserRound}
          detail={account.name ?? undefined}
          onClick={() => {
            onClose();
            onEditName();
          }}
        >
          Your name
        </SheetRow>
      )}
      <SheetRow
        icon={theme === "dark" ? Sun : Moon}
        onClick={() => {
          toggleTheme();
          // Signed in: the choice follows the account to other devices.
          if (account) void updateProfile({ theme: theme === "dark" ? "light" : "dark" });
        }}
        detail={theme === "dark" ? "Dark" : "Light"}
        chevron={false}
      >
        Appearance
      </SheetRow>
      <SheetRow
        icon={Cookie}
        onClick={() => {
          onClose();
          manageCookies(true);
        }}
      >
        Cookie preferences
      </SheetRow>
      <SheetRow icon={BookOpen} href={docsHref("/docs/coding-agent")}>
        How the Coding Agent works
      </SheetRow>
      <SheetRow icon={Terminal} href={docsHref("/docs/cli/install")}>
        Install the CLI
      </SheetRow>
      {!CODING_AGENT_ONLY && (
        <Link to="/settings" onClick={onClose} className="block">
          <SheetRow icon={Settings}>Settings</SheetRow>
        </Link>
      )}

      {account && (
        <>
          <div className="my-2 border-t border-border" />
          <SheetRow
            icon={LogOut}
            chevron={false}
            onClick={() => {
              onClose();
              void signOut();
            }}
          >
            Sign out
          </SheetRow>
        </>
      )}
    </Modal>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A reply as one line of plain text: Markdown marks and line breaks removed. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Changes worth knowing about, newest first. Real features only. */
const NEWS: { title: string; body: string; date: string; href: string; tint: string }[] = [
  {
    title: "A new Coding Agent",
    body: "Watch the agent's plan and every command it runs, open any step to see its output, and send a preview error straight back with Fix with agent.",
    date: "2026-10-30",
    href: "/docs/coding-agent",
    tint: "from-primary/70 to-warning/40",
  },
  {
    title: "Signed CLI releases",
    body: "Every CLI release is built in CI and signed with Sigstore. The installer and devstation upgrade check the signature for the exact version.",
    date: "2026-10-28",
    href: "/docs/cli/install",
    tint: "from-info/70 to-success/30",
  },
  {
    title: "Verified auto-labels",
    body: "Contracts you deploy through DevStation get a trusted label, published only after the chain shows your wallet created them.",
    date: "2026-10-28",
    href: "/docs/labels",
    tint: "from-success/60 to-info/30",
  },
];

export function NewsSheet({
  projects,
  onOpen,
  onClose,
}: {
  projects: AppProject[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"updates" | "news">(projects.length ? "updates" : "news");
  const recent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12);
  return (
    <Modal onClose={onClose} wide>
      <div className="flex justify-center">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "updates", label: "Your projects" },
            { value: "news", label: "What's new" },
          ]}
        />
      </div>
      {tab === "updates" ? (
        recent.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-muted-foreground">
            Nothing yet. When the agent finishes work on a project, it shows up here.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {recent.map((p) => {
              const last = [...p.turns].reverse().find((t) => t.role === "assistant");
              return (
                <li key={p.id}>
                  <button
                    onClick={() => {
                      onClose();
                      onOpen(p.id);
                    }}
                    className="w-full py-3 text-left"
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[14px] font-medium text-foreground">
                        {p.name}
                      </span>
                      <span className="shrink-0 text-[11px] text-meta">{ago(p.updatedAt)}</span>
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-5 text-muted-foreground">
                      {last
                        ? `${last.failed ? "Did not finish: " : ""}${plain(last.text)}`
                        : `${plural(Object.keys(p.files).length, "file")}, no conversation yet`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="mt-4 space-y-5">
          {NEWS.filter((n) => !CODING_AGENT_ONLY || servedInAgentOnly(n.href)).map((n) => (
            <a key={n.title} href={docsHref(n.href)} className="group block">
              <div
                className={cn(
                  "relative h-28 overflow-hidden rounded-2xl bg-gradient-to-br",
                  n.tint,
                )}
              >
                <div className="absolute inset-x-4 bottom-0 top-5 rounded-t-xl border border-white/20 bg-background/70 p-3 backdrop-blur">
                  <div className="h-2 w-16 rounded bg-foreground/30" />
                  <div className="mt-2 h-2 w-28 rounded bg-foreground/15" />
                  <div className="mt-1.5 h-2 w-24 rounded bg-foreground/15" />
                </div>
              </div>
              <p className="mt-3 flex items-center gap-2 text-[15px] font-semibold text-foreground">
                {n.title}
                <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
              </p>
              <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{n.body}</p>
              <p className="mt-1 text-[11.5px] text-meta">{ago(Date.parse(n.date))}</p>
            </a>
          ))}
        </div>
      )}
    </Modal>
  );
}

/** Everything you can do with a project, as a list. */
export function ProjectSheet({
  project,
  fileCount,
  running,
  canPublish,
  hasRepo,
  canPullRequest,
  onShare,
  onPush,
  onPullRequest,
  onPublish,
  onDownload,
  onRemix,
  onRename,
  onDelete,
  onClose,
}: {
  project: AppProject;
  fileCount: number;
  running: boolean;
  canPublish: boolean;
  hasRepo: boolean;
  canPullRequest: boolean;
  onShare: () => void;
  onPush: () => void;
  onPullRequest: () => void;
  onPublish: () => void;
  onDownload: () => void;
  onRemix: () => void;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal onClose={onClose}>
      <p className="truncate px-2 text-[16px] font-semibold text-foreground">{project.name}</p>
      <p className="px-2 pb-2 text-[11.5px] text-meta">
        {plural(fileCount, "file")} · updated {ago(project.updatedAt)}
      </p>
      <SheetRow
        icon={Rocket}
        onClick={act(onPublish)}
        disabled={!canPublish || running}
        detail={project.liveUrl ? "Live" : undefined}
      >
        {project.liveUrl ? "Update the live app" : "Publish"}
      </SheetRow>
      <SheetRow icon={Users} onClick={act(onShare)}>
        Invite builders
      </SheetRow>
      <SheetRow icon={Github} onClick={act(onPush)} disabled={!fileCount || running}>
        Push to GitHub
      </SheetRow>
      {hasRepo && (
        <SheetRow
          icon={GitPullRequest}
          onClick={act(onPullRequest)}
          disabled={!canPullRequest || running}
        >
          Open a pull request
        </SheetRow>
      )}
      <SheetRow icon={Download} onClick={act(onDownload)} disabled={!fileCount}>
        Download as zip
      </SheetRow>
      <SheetRow icon={GitFork} onClick={act(onRemix)}>
        Remix into a copy
      </SheetRow>
      <SheetRow icon={Pencil} onClick={act(onRename)}>
        Rename
      </SheetRow>
      {!CODING_AGENT_ONLY && (
        <Link to="/launchkit/marketplace/sell" onClick={onClose} className="block">
          <SheetRow icon={Store}>Sell on the marketplace</SheetRow>
        </Link>
      )}
      <div className="my-2 border-t border-border" />
      <SheetRow icon={LifeBuoy} href={docsHref("/docs/coding-agent")}>
        Help
      </SheetRow>
      {confirming ? (
        <div className="mt-2 rounded-2xl border border-danger/40 bg-danger/5 p-3">
          <p className="text-[12.5px] leading-5 text-foreground">
            Delete {project.name} from this browser? Its conversation and files go too. A copy on
            GitHub or a live app is not touched.
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="rounded-full px-3.5 py-1.5 text-[12px] text-muted-foreground hover:bg-surface-2"
            >
              Keep it
            </button>
            <button
              onClick={act(onDelete)}
              className="rounded-full bg-danger px-3.5 py-1.5 text-[12px] font-medium text-white"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <SheetRow icon={Trash2} danger chevron={false} onClick={() => setConfirming(true)}>
          Delete project
        </SheetRow>
      )}
    </Modal>
  );
}
