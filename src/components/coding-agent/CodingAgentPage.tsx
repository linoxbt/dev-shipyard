import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Box,
  Bug,
  Eye,
  FlaskConical,
  FolderUp,
  Github,
  GitPullRequest,
  Hammer,
  LoaderCircle,
  Lightbulb,
  Pencil,
  Plus,
  Rocket,
  Terminal,
  TriangleAlert,
  LogIn,
  X,
} from "lucide-react";
import { SplitLayout } from "@/components/appbuilder/SplitLayout";
import { PublishDialog } from "@/components/appbuilder/PublishDialog";
import { ActivityPane } from "@/components/coding-agent/ActivityPane";
import { CodePane } from "@/components/coding-agent/CodePane";
import { Composer, ToolChip } from "@/components/coding-agent/Composer";
import { BuildersDialog, GithubDialog } from "@/components/coding-agent/dialogs";
import { AppDrawer } from "@/components/coding-agent/AppDrawer";
import { AuthSheet } from "@/components/coding-agent/AuthSheet";
import { WelcomeSheet } from "@/components/coding-agent/WelcomeSheet";
import { ModeButton, ModeSheet, ModelButton, ModelSheet } from "@/components/coding-agent/pickers";
import { Landing, type HomeTab } from "@/components/coding-agent/Landing";
import {
  Dropdown,
  MenuItem,
  MenuLabel,
  Modal,
  inputClass,
  primaryButton,
} from "@/components/coding-agent/primitives";
import { AccountSheet, NewsSheet, ProjectSheet } from "@/components/coding-agent/sheets";
import { PreviewPane } from "@/components/coding-agent/PreviewPane";
import { TabBar, TopBar, type View } from "@/components/coding-agent/TopBar";
import {
  AgentIntro,
  AssistantMessage,
  LiveTurn,
  UserMessage,
} from "@/components/coding-agent/Transcript";
import {
  nameFromPrompt,
  onProjectsWriteError,
  useProjects,
  type AppProject,
  type ProjectTurn,
} from "@/lib/appgen/projects";
import { downloadZip } from "@/lib/appgen/zip";
import { filesUnder, localPreviewPlan } from "@/lib/appgen/local-preview";
import { compactSteps, stepsFromEvents, type AgentEvent } from "@/lib/coding-agent/steps";
import { postWorkspace, slugOf } from "@/lib/coding-agent/workspace-client";
import { AGENT_PATH } from "@/lib/features";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useAuth } from "@/hooks/useAuth";
import { getPreference, setPreference } from "@/lib/consent";
import { AUTO_MODEL, MODEL_IDS, type AgentMode } from "@/lib/coding-agent/models";
import { useIsMobile } from "@/hooks/useIsMobile";
import { chainConfig } from "@/lib/chains";
import { docsHref } from "@/lib/site-hosts";
import { cn } from "@/lib/utils";

// The Coding Agent: one conversation, one workspace, anything.
//
// It is the CLI's agent running on DevStation's runner. Start from nothing, from
// a public GitHub repository, from files or a folder you drop in, or from one of
// your apps, and keep talking to it. It writes code, runs commands, installs
// packages and tests its work in a sandbox; anything with a web page gets a
// live preview. GitHub is only asked for when you push or open a pull request.
//
// The layout follows the builders people already know. The first screen is one
// big prompt with your projects underneath (Lovable, Base44). A project opens
// into a bar across the top (switch project; Preview, Code or Activity; Share,
// GitHub, Publish), the conversation on the left and the work on the right.
// The conversation reads like Claude Code on the web: the agent's checklist,
// every tool call as a step you can open to see the command and its output,
// and the files a turn changed as chips that open them.

interface Handoff {
  tool: string;
  args: Record<string, unknown>;
}

interface WorkspaceView {
  id: string;
  phase: "idle" | "running" | "error" | "cancelled";
  status: string;
  prompt: string;
  reply: string;
  events: AgentEvent[];
  turns: number;
  steps: number;
  costUsd: number;
  changed: string[];
  handoffs: Handoff[];
  error: string | null;
  revision: number;
  fileCount: number;
  source: { kind: "blank" | "files" | "github"; repo?: string; ref?: string };
  preview: {
    phase: "none" | "building" | "ready" | "error" | "unsupported";
    revision: number;
    message: string | null;
  };
}

type Source = NonNullable<AppProject["source"]>;
type Starter =
  | { kind: "blank" }
  | { kind: "github"; repo: string }
  | { kind: "files"; files: Record<string, string>; label: string };

/** What came back from linking GitHub to this account. */
const GITHUB_RESULT: Record<string, string> = {
  connected: "GitHub connected. Push or open your pull request now.",
  connect_wallet: "Connect a user first: a GitHub account is linked to one user.",
  wallet_linked:
    "This user is already linked to a different GitHub account. Unlink it on your dashboard first.",
  github_linked: "That GitHub account is already linked to another user.",
  no_account: "GitHub did not say who you are. Try connecting again.",
  unreachable: "DevStation could not record the link. Try again shortly.",
};

const MODEL_PREF = "devstation-agent-model";
const MODE_PREF = "devstation-agent-mode";

/** When the updates sheet was last opened, for the dot on the bell. */
const NEWS_SEEN_KEY = "devstation-agent-news-seen";

const SKIP_UPLOAD = /(^|\/)(node_modules|\.git|dist|build|\.next|\.turbo|\.venv|__pycache__)\//;

/** Quick asks for a project that has files but no conversation yet. */
const FIRST_ASKS: {
  label: string;
  prompt: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    label: "Explain this project",
    prompt: "Explain how this project works and how it is laid out.",
    icon: Lightbulb,
  },
  {
    label: "Find and fix bugs",
    prompt: "Look for bugs in this project, fix the real ones and tell me what you changed.",
    icon: Bug,
  },
  {
    label: "Add tests",
    prompt: "Add tests for the most important behaviour and make sure they pass.",
    icon: FlaskConical,
  },
];

/** Text files from a file or folder picker, skipping dependencies, build output
 *  and anything binary or too large to be worth handing an agent. */
async function readUploads(
  list: FileList,
): Promise<{ files: Record<string, string>; skipped: number }> {
  const files: Record<string, string> = {};
  let skipped = 0;
  let bytes = 0;
  const entries = Array.from(list);
  const rootPrefix = (() => {
    const paths = entries.map(
      (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    );
    const first = paths[0]?.split("/")[0];
    return first && paths.every((p) => p.startsWith(`${first}/`)) ? `${first}/` : "";
  })();
  for (const file of entries) {
    const rel = (
      (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
    ).slice(rootPrefix.length);
    if (!rel || SKIP_UPLOAD.test(rel) || file.size > 1024 * 1024) {
      skipped++;
      continue;
    }
    const text = await file.text();
    if (text.slice(0, 8000).includes("\0")) {
      skipped++;
      continue;
    }
    bytes += text.length;
    if (bytes > 5 * 1024 * 1024 || Object.keys(files).length >= 3000) {
      skipped++;
      continue;
    }
    files[rel] = text;
  }
  return { files, skipped };
}

export function CodingAgentPage() {
  // Who is signed in (email, through Supabase). Their email doubles as the
  // project owner label kept in this browser.
  const account = useAuth((s) => s.account);
  const user = account?.email;
  const { chainId } = useActiveChain();
  const projects = useProjects((s) => s.projects);
  const activeId = useProjects((s) => s.activeId);
  const project = projects.find((p) => p.id === activeId) ?? null;

  const [view, setView] = useState<WorkspaceView | null>(null);
  const [dist, setDist] = useState<Record<string, string> | null>(null);
  // The preview's images and fonts, as base64. Held here and not saved with the
  // project: browser storage would fill up, and the next poll fetches them.
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState<View>("preview");
  const [starter, setStarter] = useState<Starter>({ kind: "blank" });
  const [repoInput, setRepoInput] = useState("");
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [dialog, setDialog] = useState<null | "push" | "pr" | "builders" | "publish">(null);
  const [prepareNote, setPrepareNote] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(true);
  const [sheet, setSheet] = useState<
    null | "drawer" | "account" | "news" | "more" | "auth" | "model" | "mode" | "welcome" | "name"
  >(null);
  // The model and mode for the next message. Remembered only with consent
  // to preference storage (lib/consent.ts).
  const [model, setModelState] = useState<string>(AUTO_MODEL);
  const [mode, setModeState] = useState<AgentMode>("build");
  useEffect(() => {
    const m = getPreference(MODEL_PREF);
    if (m && (m === AUTO_MODEL || MODEL_IDS.includes(m))) setModelState(m);
    if (getPreference(MODE_PREF) === "plan") setModeState("plan");
  }, []);
  const setModel = (m: string) => {
    setModelState(m);
    setPreference(MODEL_PREF, m);
  };
  const setMode = (m: AgentMode) => {
    setModeState(m);
    setPreference(MODE_PREF, m);
  };
  const [homeTab, setHomeTab] = useState<HomeTab>("recent");
  const [renaming, setRenaming] = useState<string | null>(null);
  /** On a phone: the one pane on screen. */
  const [pane, setPane] = useState<"chat" | View>("chat");
  const [newsSeen, setNewsSeen] = useState(0);
  const folderInput = useRef<HTMLInputElement | null>(null);
  const mobile = useIsMobile();
  /** The workbench's view: the phone's pane, or the desktop switch. */
  const shownTab: View = mobile ? (pane === "chat" ? "preview" : pane) : tab;
  const preparing = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Follow new output only while the reader is at the bottom: scrolling up to
  // read an earlier step should not be yanked back down by the next one.
  const stickToBottom = useRef(true);
  const previewSeen = useRef<string>("");

  useEffect(() => {
    setNewsSeen(Number(getPreference(NEWS_SEEN_KEY)) || 0);
    useAuth.getState().init();
  }, []);

  // A new account has no name yet: ask for it, and for a theme, once.
  const welcomed = useRef(false);
  useEffect(() => {
    if (account && !account.name && !welcomed.current) {
      welcomed.current = true;
      setSheet("welcome");
    }
  }, [account]);

  useEffect(() => {
    useProjects.getState().hydrate();
    onProjectsWriteError((message) => toast.error(message));
    return () => onProjectsWriteError(null);
  }, []);

  // Back from GitHub sign-in: say so, and tidy the address bar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gh = params.get("github");
    if (!gh) return;
    if (gh === "connected") toast.success(GITHUB_RESULT.connected);
    else toast.error(GITHUB_RESULT[gh] ?? `GitHub sign-in did not finish (${gh}).`);
    params.delete("github");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);

  // Opened from a builder invite: ?join=<workspace>&name=<app>. Waits for a
  // sign-in, because joining is checked against the account the owner added.
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const join = params.get("join");
    if (!join) return;
    const name = params.get("name");
    params.delete("join");
    params.delete("name");
    const qs = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    void (async () => {
      const store = useProjects.getState();
      store.hydrate();
      const existing = store.projects.find((p) => p.workspaceId === join);
      if (existing) return store.open(existing.id);
      const result = await postWorkspace({ action: "join", id: join });
      if (!result.ok) {
        toast.error(String(result.data.message ?? "Could not open that app."));
        return;
      }
      const ws = result.data.workspace as WorkspaceView;
      const id = store.create(name || "Shared app", user);
      store.update(id, {
        files: (result.data.files as Record<string, string>) ?? {},
        workspaceId: ws.id,
        workspaceTurns: ws.turns,
        source: ws.source,
        role: result.data.role === "owner" ? "owner" : "builder",
        shared: true,
      });
      toast.success("You are building on this app. Its files, preview and agent are shared.");
    })();
  }, [user]);

  const files = useMemo(() => project?.files ?? {}, [project?.files]);
  const turns: ProjectTurn[] = project?.turns ?? [];
  const running = view?.phase === "running";
  const building = view?.preview.phase === "building";
  const localPlan = useMemo(() => localPreviewPlan(files), [files]);
  const shared = !!(project?.shared || project?.role === "builder");

  useEffect(() => {
    setView(null);
    setHandoffs([]);
    setOpenFile(null);
    previewSeen.current = "";
    stickToBottom.current = true;
    setDist(project?.dist ?? null);
    setAssets({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Record a finished turn once, whether this tab saw it start or not.
  const absorb = useCallback(async (next: WorkspaceView) => {
    const state = useProjects.getState();
    const current = state.projects.find((p) => p.id === state.activeId);
    if (!current || current.workspaceId !== next.id) return;

    if (next.phase !== "running" && next.turns > (current.workspaceTurns ?? 0)) {
      const res = await fetch(`/api/workspace?id=${encodeURIComponent(next.id)}&files=1`).catch(
        () => null,
      );
      const body = (await res?.json().catch(() => null)) as {
        files?: Record<string, string>;
      } | null;
      const failed = next.phase === "error";
      // A turn another builder started arrives here without its question.
      const last = current.turns.at(-1);
      const askedHere = last?.role === "user" && last.text === next.prompt;
      const asked = askedHere ? last : null;
      const question: ProjectTurn[] =
        !askedHere && next.prompt ? [{ role: "user", text: next.prompt }] : [];
      const text =
        next.phase === "cancelled"
          ? next.reply || "Stopped."
          : failed
            ? next.error || "That did not work."
            : next.reply ||
              (next.changed.length ? `Changed ${next.changed.length} file(s).` : "Done.");
      const steps = compactSteps(stepsFromEvents(next.events ?? []));
      state.save({
        ...(body?.files ? { files: body.files } : {}),
        workspaceTurns: next.turns,
        turns: [
          ...current.turns,
          ...question,
          {
            role: "assistant",
            text,
            changed: next.changed,
            failed,
            ...(steps.length ? { steps } : {}),
            // Answering a Plan message: the reply is a plan to approve.
            ...(asked?.plan ? { plan: true } : {}),
          },
        ],
      });
      setHandoffs(next.handoffs ?? []);
    }

    const key = `${next.id}:${next.preview.revision}`;
    if (next.preview.phase === "ready" && previewSeen.current !== key) {
      previewSeen.current = key;
      const res = await fetch(`/api/workspace?id=${encodeURIComponent(next.id)}&preview=1`).catch(
        () => null,
      );
      const body = (await res?.json().catch(() => null)) as {
        dist?: Record<string, string>;
        assets?: Record<string, string>;
      } | null;
      if (body?.dist) {
        setDist(body.dist);
        setAssets(body.assets ?? {});
        state.save({ dist: body.dist });
      }
    }
  }, []);

  // Reattach and poll. The work runs on the runner, so a refresh or a closed
  // tab loses nothing; this only reads where it has got to.
  const workspaceId = project?.workspaceId ?? null;
  useEffect(() => {
    if (!workspaceId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      const res = await fetch(`/api/workspace?id=${encodeURIComponent(workspaceId)}`).catch(
        () => null,
      );
      if (!alive) return;
      if (res?.status === 404) {
        // Swept after days idle. The files are still here, so forget the id
        // and the project gets a fresh workspace from them.
        setView(null);
        const state = useProjects.getState();
        if (state.active()?.workspaceId === workspaceId) {
          state.save({ workspaceId: null, workspaceTurns: 0 });
        }
        return;
      }
      if (res?.status === 403) {
        setView(null);
        return;
      }
      const body = (await res?.json().catch(() => null)) as { workspace?: WorkspaceView } | null;
      if (body?.workspace) {
        setView(body.workspace);
        await absorb(body.workspace);
        const busy =
          body.workspace.phase === "running" || body.workspace.preview.phase === "building";
        // Shared: keep an eye out for another builder's turns, slowly.
        if (!busy) {
          if (shared) timer = setTimeout(() => void tick(), 8000);
          return;
        }
      }
      timer = setTimeout(() => void tick(), 1500);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [workspaceId, view?.turns, sending, absorb, shared]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTo({ top: el.scrollHeight });
  }, [turns.length, view?.reply, view?.status, view?.events?.length, sending]);

  const chain = chainConfig(chainId);
  const networkContext = useMemo(() => {
    const c = chainConfig(chainId);
    return `The person has ${c.name} (chain id ${chainId}) selected in DevStation. RPC: ${c.rpcUrl}. Explorer: ${c.explorerUrl}. Use this network when the work involves one, unless they say otherwise.`;
  }, [chainId]);

  const sourceFor = (p: AppProject): Source =>
    p.source ?? { kind: Object.keys(p.files).length ? "files" : "blank" };

  const restoreBody = (p: AppProject) => {
    const src = sourceFor(p);
    if (Object.keys(p.files).length > 0)
      return { kind: "files", files: p.files, repo: src.repo, ref: src.ref };
    if (src.kind === "github" && src.repo) return { kind: "github", repo: src.repo, ref: src.ref };
    return { kind: "blank" };
  };

  // An app that arrived with its files -- cloned or bought on the marketplace,
  // remixed, uploaded -- previews as soon as it is opened. A plain page renders
  // in the browser (localPlan "static"); one that needs a build gets a
  // workspace from its files and a build, with no prompt. Opening a project
  // never means starting it again.
  useEffect(() => {
    setPrepareNote(null);
    if (!project || dist || running || sending || localPlan.kind !== "build") return;
    if (!user) {
      setPrepareNote("Connect a user to build this app's preview. It costs no gas.");
      return;
    }
    if (project.workspaceId && !view) return; // still reading the workspace
    if (view && view.preview.phase !== "none") return;
    const key = `${project.id}:${project.workspaceId ?? "new"}`;
    if (preparing.current === key) return;
    preparing.current = key;
    void (async () => {
      let id = project.workspaceId ?? null;
      if (!id) {
        const made = await postWorkspace({ action: "create", source: restoreBody(project) });
        if (!made.ok) {
          setPrepareNote(String(made.data.message ?? "The preview could not start."));
          return;
        }
        const ws = made.data.workspace as WorkspaceView;
        preparing.current = `${project.id}:${ws.id}`;
        useProjects.getState().update(project.id, {
          workspaceId: ws.id,
          workspaceTurns: ws.turns,
          source: project.source ?? ws.source,
        });
        id = ws.id;
      }
      const started = await postWorkspace({ action: "preview", id });
      if (started.ok && started.data.workspace) {
        if (useProjects.getState().activeId === project.id) {
          setView(started.data.workspace as WorkspaceView);
        }
      } else {
        setPrepareNote(String(started.data.message ?? "The preview could not start."));
      }
    })();
    // restoreBody is a plain helper recreated each render; project covers it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, dist, running, sending, localPlan.kind, user, view]);

  /** The active project's workspace, started from its files if it has none yet. */
  const ensureWorkspace = async (): Promise<string | null> => {
    const current = useProjects.getState().active();
    if (!current) return null;
    if (current.workspaceId) return current.workspaceId;
    const made = await postWorkspace({ action: "create", source: restoreBody(current) });
    if (!made.ok) {
      toast.error(String(made.data.message ?? "Could not start a workspace."));
      return null;
    }
    const ws = made.data.workspace as WorkspaceView;
    useProjects.getState().save({ workspaceId: ws.id, workspaceTurns: ws.turns });
    return ws.id;
  };

  const remix = () => {
    if (!project) return;
    const id = useProjects.getState().remix(project.id, user ?? null);
    const made = id ? useProjects.getState().projects.find((p) => p.id === id) : null;
    if (made) toast.success(`Remixed into "${made.name}". The original is untouched.`);
  };

  const send = useCallback(
    async (override?: string, modeOverride?: AgentMode) => {
      const prompt = (override ?? input).trim();
      if (!prompt || sending || running) return;
      if (!user) {
        setSheet("auth");
        return;
      }
      const turnMode = modeOverride ?? mode;
      const turn = { model, mode: turnMode };
      setSending(true);
      setHandoffs([]);
      stickToBottom.current = true;
      const store = useProjects.getState();

      if (!store.activeId) {
        store.create(nameFromPrompt(prompt) || "Untitled project", user);
        if (starter.kind === "github") {
          store.save({ source: { kind: "github", repo: starter.repo } });
        } else if (starter.kind === "files") {
          store.save({ source: { kind: "files" }, files: starter.files });
        } else {
          store.save({ source: { kind: "blank" } });
        }
      }
      const current = useProjects.getState().active()!;
      store.save({
        turns: [
          ...current.turns,
          { role: "user", text: prompt, ...(turnMode === "plan" ? { plan: true } : {}) },
        ],
      });
      setInput("");

      const result = current.workspaceId
        ? await postWorkspace({
            action: "message",
            id: current.workspaceId,
            prompt,
            context: networkContext,
            restore: restoreBody(current),
            ...turn,
          })
        : await postWorkspace({
            action: "create",
            source: restoreBody(current),
            prompt,
            context: networkContext,
            ...turn,
          });

      if (!result.ok) {
        const latest = useProjects.getState().active()!;
        useProjects.getState().save({
          turns: [
            ...latest.turns,
            {
              role: "assistant",
              text: String(result.data.message ?? "That could not start."),
              failed: true,
            },
          ],
        });
      } else {
        const workspace = result.data.workspace as WorkspaceView;
        const latest = useProjects.getState().active()!;
        const fresh = latest.workspaceId !== workspace.id;
        useProjects.getState().save({
          workspaceId: workspace.id,
          ...(fresh ? { workspaceTurns: Math.max(0, workspace.turns) } : {}),
          source:
            latest.source?.kind === "github" && !latest.source.ref
              ? { kind: "github", repo: workspace.source.repo, ref: workspace.source.ref }
              : (latest.source ?? workspace.source),
        });
        setView(workspace);
        setStarter({ kind: "blank" });
      }
      setSending(false);
    },
    // restoreBody is a plain helper recreated each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, sending, running, user, starter, networkContext, model, mode],
  );

  const stop = async () => {
    if (!view) return;
    await postWorkspace({ action: "cancel", id: view.id });
  };

  const rebuildPreview = async () => {
    if (!view) return;
    const result = await postWorkspace({ action: "preview", id: view.id });
    if (result.ok && result.data.workspace) setView(result.data.workspace as WorkspaceView);
    else toast.error(String(result.data.message ?? "The preview could not start."));
  };

  const newProject = () => {
    useProjects.setState({ activeId: null });
    setStarter({ kind: "blank" });
    setRepoInput("");
    setInput("");
    setDist(null);
    setAssets({});
    setTab("preview");
  };

  /** What would go live: the built output, or the app's own folder. */
  const publishSource = useMemo(
    () => dist ?? (localPlan.kind === "static" ? filesUnder(files, localPlan.dir) : null),
    [dist, files, localPlan],
  );

  // The address is chosen in the dialog, not taken from the project's name:
  // names repeat across people, addresses cannot.
  const openPublish = () => {
    if (!project) return;
    if (!user) return toast.error("Connect a user to publish.");
    if (!publishSource) return toast.error("There is no built web page to publish yet.");
    setDialog("publish");
  };

  const ensureGithub = async (): Promise<boolean> => {
    const res = await fetch("/api/github").catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      configured?: boolean;
      user?: unknown;
    } | null;
    if (!body?.configured) {
      toast.error("GitHub sign-in is not configured on this deployment.");
      return false;
    }
    if (body.user) return true;
    window.location.href = `/api/github?start=1&return=${encodeURIComponent(AGENT_PATH)}`;
    return false;
  };

  const openDialog = async (which: "push" | "pr") => {
    if (await ensureGithub()) setDialog(which);
  };

  const showFile = (path: string) => {
    setOpenFile(path);
    setTab("code");
    setPane("code");
  };

  const scrollToTop = () => {
    document.querySelector("[data-agent-home]")?.scrollTo({ top: 0, behavior: "smooth" });
  };

  /** "Fix with agent" on a preview error: send it straight away when the agent
   *  is free, otherwise leave it in the box to send next. */
  const fixError = (message: string) => {
    if (running || sending) {
      setInput(message);
      toast.message("The agent is busy. The error is in the message box, ready to send.");
      return;
    }
    void send(message);
  };

  const signInNotice = !user ? (
    <button
      onClick={() => setSheet("auth")}
      className="flex items-center gap-1.5 text-left text-[11.5px] text-muted-foreground hover:text-foreground"
    >
      <LogIn className="h-3.5 w-3.5 shrink-0 text-primary" /> Sign in with your email to start
      building. It is free.
    </button>
  ) : null;

  const openProject = (id: string) => {
    useProjects.getState().open(id);
    setPane("chat");
  };
  const deleteProject = (id: string) => {
    const name = projects.find((p) => p.id === id)?.name;
    useProjects.getState().remove(id);
    toast.success(`Deleted ${name ?? "the project"}.`);
  };
  const remixProject = (id: string) => {
    const made = useProjects.getState().remix(id, user ?? null);
    const copy = made ? useProjects.getState().projects.find((p) => p.id === made) : null;
    if (copy) toast.success(`Remixed into "${copy.name}". The original is untouched.`);
  };
  const latestUpdate = projects.reduce((m, p) => Math.max(m, p.updatedAt), 0);
  const newsDot = latestUpdate > newsSeen;
  const openNews = () => {
    setSheet("news");
    setNewsSeen(Date.now());
    setPreference(NEWS_SEEN_KEY, String(Date.now()));
  };

  // Everything that floats over the page: the drawer and the sheets.
  const overlays = (
    <>
      {sheet === "drawer" && (
        <AppDrawer
          projects={projects}
          activeId={activeId}
          onOpen={openProject}
          onNew={newProject}
          onTemplates={() => {
            newProject();
            setHomeTab("templates");
          }}
          onAccount={() => setSheet("account")}
          onNews={openNews}
          newsDot={newsDot}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "account" && (
        <AccountSheet
          projects={projects}
          usage={project && view ? { steps: view.steps, costUsd: view.costUsd } : null}
          onSignIn={() => setSheet("auth")}
          onEditName={() => setSheet("name")}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "auth" && (
        // Signing in may already have opened the welcome sheet: leave it open.
        <AuthSheet onClose={() => setSheet((s) => (s === "auth" ? null : s))} />
      )}
      {sheet === "welcome" && <WelcomeSheet onClose={() => setSheet(null)} />}
      {sheet === "name" && <WelcomeSheet only="name" onClose={() => setSheet(null)} />}
      {sheet === "model" && (
        <ModelSheet value={model} onChange={setModel} onClose={() => setSheet(null)} />
      )}
      {sheet === "mode" && (
        <ModeSheet value={mode} onChange={setMode} onClose={() => setSheet(null)} />
      )}
      {sheet === "news" && (
        <NewsSheet projects={projects} onOpen={openProject} onClose={() => setSheet(null)} />
      )}
    </>
  );

  // ---------------------------------------------------------------- landing

  if (!project) {
    const startIcon =
      starter.kind === "github" ? Github : starter.kind === "files" ? FolderUp : Box;
    return (
      <div className="h-dvh">
        <input
          ref={folderInput}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error -- non-standard, supported by every current browser
          webkitdirectory=""
          onChange={async (e) => {
            if (!e.target.files?.length) return;
            const read = await readUploads(e.target.files);
            e.target.value = "";
            const count = Object.keys(read.files).length;
            if (count === 0) return toast.error("None of those files could be read as text.");
            setStarter({ kind: "files", files: read.files, label: `${count} files` });
            toast.success(
              `${count} files ready${read.skipped ? `, ${read.skipped} left out` : ""}.`,
            );
          }}
        />
        <Landing
          projects={projects}
          tab={homeTab}
          onTab={setHomeTab}
          onOpen={openProject}
          onRemix={remixProject}
          onDelete={deleteProject}
          onIdea={(prompt) => {
            setInput(prompt);
            scrollToTop();
          }}
          onMenu={() => setSheet("drawer")}
          onNews={openNews}
          onAccount={() => setSheet("account")}
          onSignIn={() => setSheet("auth")}
          newsDot={newsDot}
          composer={
            <Composer
              variant="hero"
              autoFocus
              value={input}
              onChange={setInput}
              onSend={() => void send()}
              sending={sending}
              canSend={!(starter.kind === "github" && !repoInput.trim())}
              placeholder="Describe the app you want to build…"
              trailing={<ModeButton value={mode} onClick={() => setSheet("mode")} />}
              notice={signInNotice}
              tools={
                <>
                  <Dropdown
                    label="Start from"
                    triggerClassName="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground/85 transition hover:border-primary/40 hover:text-foreground"
                    trigger={() => <Plus className="h-4 w-4" />}
                  >
                    {(close) => (
                      <>
                        <MenuLabel>Start from</MenuLabel>
                        <MenuItem
                          icon={Box}
                          onClick={() => {
                            close();
                            setStarter({ kind: "blank" });
                          }}
                        >
                          Nothing: a blank workspace
                        </MenuItem>
                        <MenuItem
                          icon={Github}
                          onClick={() => {
                            close();
                            setStarter({ kind: "github", repo: repoInput });
                          }}
                        >
                          A GitHub repository
                        </MenuItem>
                        <MenuItem
                          icon={FolderUp}
                          onClick={() => {
                            close();
                            folderInput.current?.click();
                          }}
                        >
                          A folder on this computer
                        </MenuItem>
                      </>
                    )}
                  </Dropdown>
                  <ModelButton value={model} onClick={() => setSheet("model")} />
                  {starter.kind !== "blank" && (
                    <ToolChip
                      icon={startIcon}
                      active
                      onClick={() => setStarter({ kind: "blank" })}
                      title="Start blank instead"
                    >
                      {starter.kind === "github" ? "Repository" : starter.label}
                      <X className="h-3.5 w-3.5 opacity-70" />
                    </ToolChip>
                  )}
                </>
              }
            />
          }
          below={
            starter.kind === "github" ? (
              <div className="rounded-2xl border border-border bg-surface p-3">
                <input
                  autoFocus
                  value={repoInput}
                  onChange={(e) => {
                    setRepoInput(e.target.value);
                    setStarter({ kind: "github", repo: e.target.value });
                  }}
                  placeholder="owner/name or https://github.com/owner/name"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-[12px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
                <p className="mt-2 text-[11px] text-meta">
                  Public repositories need no sign-in. For a private one, connect GitHub from Push
                  first.
                </p>
              </div>
            ) : starter.kind === "files" ? (
              <p className="px-2 text-[11.5px] text-meta">
                {starter.label} will be copied into the workspace.
              </p>
            ) : null
          }
          footer={
            <a
              href={docsHref("/docs/cli/install")}
              className="inline-flex items-center gap-1.5 text-[11.5px] text-meta hover:text-muted-foreground"
            >
              <Terminal className="h-3.5 w-3.5" /> The same agent runs in your terminal
            </a>
          }
        />
        {overlays}
      </div>
    );
  }

  // -------------------------------------------------------------- workspace

  const liveReply = running ? (view?.reply ?? "") : "";
  const empty = turns.length === 0 && !sending;
  const hasFiles = Object.keys(files).length > 0;
  const source = sourceFor(project);
  const lastUser = [...turns].reverse().find((t) => t.role === "user");

  const chat = (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto max-w-2xl space-y-4 px-3 pb-6 sm:px-5">
          <AgentIntro name="DevStation Agent" busy={running || sending} />

          {empty && (
            <div className="space-y-4">
              <div className="max-w-[88%] rounded-[24px] bg-surface-2 px-4 py-3 text-[14px] leading-[1.65] text-foreground">
                {hasFiles
                  ? `Hi! I have the ${Object.keys(files).length} files of ${project.name} open. Ask me for a change, a fix or a test, and I will work on them in a sandbox.`
                  : `Hi! Tell me what to build for ${project.name} and I will start.`}
              </div>
              {hasFiles && (
                <div className="flex flex-wrap gap-2">
                  {FIRST_ASKS.map((a) => (
                    <button
                      key={a.label}
                      onClick={() => void send(a.prompt)}
                      disabled={!user}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-3.5 py-2 text-[12.5px] text-foreground/85 transition hover:border-primary/40 hover:text-foreground disabled:opacity-50"
                    >
                      <a.icon className="h-4 w-4 text-primary" /> {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {turns.map((t, i) =>
            t.role === "user" ? (
              <UserMessage
                key={i}
                text={t.text}
                plan={t.plan}
                onAskAgain={
                  t === lastUser && !running && !sending ? () => void send(t.text) : undefined
                }
              />
            ) : (
              <AssistantMessage
                key={i}
                turn={t}
                onOpenFile={showFile}
                onBuildPlan={
                  t.plan && !t.failed && i === turns.length - 1 && !running && !sending
                    ? () => void send("The plan looks good. Build it.", "build")
                    : undefined
                }
              />
            ),
          )}

          {(running || sending) && (
            <LiveTurn
              events={running ? (view?.events ?? []) : []}
              reply={liveReply}
              status={running ? (view?.status ?? "") : "Starting the workspace"}
            />
          )}

          {!running && handoffs.length > 0 && (
            <div className="space-y-2">
              {handoffs.map((h, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-[22px] border border-primary/30 bg-primary/5 px-4 py-3"
                >
                  {h.tool === "publish_app" ? (
                    <Rocket className="h-4 w-4 shrink-0 text-primary" />
                  ) : h.tool === "push_to_github" ? (
                    <Github className="h-4 w-4 shrink-0 text-primary" />
                  ) : (
                    <GitPullRequest className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <span className="flex-1 text-[13px] text-foreground">
                    {h.tool === "push_to_github"
                      ? "The agent suggests pushing this to GitHub."
                      : h.tool === "publish_app"
                        ? "The agent suggests publishing this app."
                        : "The agent proposes a pull request."}
                  </span>
                  <button
                    onClick={() =>
                      h.tool === "publish_app"
                        ? openPublish()
                        : void openDialog(h.tool === "push_to_github" ? "push" : "pr")
                    }
                    className="rounded-full bg-primary px-3.5 py-1.5 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    {h.tool === "publish_app"
                      ? "Publish"
                      : h.tool === "push_to_github"
                        ? "Push"
                        : "Review"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-2xl px-3 pb-3 sm:px-5">
        <div className="mb-2 flex items-center gap-2 px-1">
          <ModeButton compact value={mode} onClick={() => setSheet("mode")} />
          <ModelButton compact value={model} onClick={() => setSheet("model")} />
        </div>
        <Composer
          value={input}
          onChange={setInput}
          onSend={() => void send()}
          onStop={() => void stop()}
          running={running}
          sending={sending}
          placeholder={running ? "Next message…" : "Message"}
          notice={signInNotice}
          plus={
            <Dropdown
              label="Quick asks"
              up
              triggerClassName="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-foreground/85 transition hover:bg-border/60"
              trigger={() => <Plus className="h-5 w-5" />}
            >
              {(close) => (
                <>
                  <MenuLabel>Ask the agent to</MenuLabel>
                  {FIRST_ASKS.map((a) => (
                    <MenuItem
                      key={a.label}
                      icon={a.icon}
                      disabled={running || sending || !user}
                      onClick={() => {
                        close();
                        void send(a.prompt);
                      }}
                    >
                      {a.label}
                    </MenuItem>
                  ))}
                  <MenuItem
                    icon={Hammer}
                    disabled={!view || running || !!building}
                    onClick={() => {
                      close();
                      void rebuildPreview();
                    }}
                  >
                    Rebuild the preview
                  </MenuItem>
                </>
              )}
            </Dropdown>
          }
        />
      </div>
    </div>
  );

  const previewFiles = dist ?? (localPlan.kind === "static" ? files : null);
  // A line under the address bar only when there is something to say.
  const previewStatus =
    view && (building || view.preview.phase === "error") ? (
      building ? (
        <span className="flex items-center gap-1.5">
          <LoaderCircle className="h-3 w-3 animate-spin" /> Installing and building the preview…
        </span>
      ) : (
        <>
          <span className="flex min-w-0 items-center gap-1.5 text-warning">
            <TriangleAlert className="h-3 w-3 shrink-0" />
            <span className="truncate">
              The preview build failed{view.preview.message ? `: ${view.preview.message}` : ""}
            </span>
          </span>
          {view.preview.message && (
            <button
              onClick={() =>
                fixError(
                  `The preview build failed with this message. Find the cause and fix it:\n\n${view.preview.message}`,
                )
              }
              className="ml-auto shrink-0 text-primary hover:underline"
            >
              Fix with agent
            </button>
          )}
        </>
      )
    ) : null;

  const previewActions = view ? (
    <button
      onClick={() => void rebuildPreview()}
      disabled={running || !!building}
      title="Install and build the preview again"
      className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
    >
      <Hammer className="h-3.5 w-3.5" />
    </button>
  ) : null;

  const previewEmpty = (
    <div className="max-w-sm text-center">
      {building || (localPlan.kind === "build" && !prepareNote && user) || running ? (
        <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-meta" />
      ) : (
        <Eye className="mx-auto h-6 w-6 text-meta" />
      )}
      <p className="mt-3 whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
        {prepareNote ??
          (running ? "The preview appears when the agent finishes this turn." : null) ??
          (localPlan.kind === "build" && !view?.preview.message
            ? "Building the preview from this app's files…"
            : null) ??
          view?.preview.message ??
          "Anything with a web page shows up here after the agent builds it. Contracts, APIs and scripts live in Code."}
      </p>
    </div>
  );

  const workbench = (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* The preview stays mounted while you read code, so the app in it
          keeps its state when you switch back. */}
      <div className={cn("min-h-0 flex-1", shownTab !== "preview" && "hidden")}>
        <PreviewPane
          files={previewFiles}
          dir={dist ? "" : localPlan.kind === "static" ? localPlan.dir : ""}
          assets={dist ? assets : undefined}
          chainName={chain.name}
          liveUrl={project.liveUrl}
          status={previewStatus}
          empty={previewEmpty}
          onFix={fixError}
          actions={previewActions}
        />
      </div>
      {shownTab === "code" && (
        <div className="min-h-0 flex-1">
          <CodePane
            files={files}
            changed={
              view?.changed ??
              [...turns].reverse().find((t) => t.role === "assistant")?.changed ??
              []
            }
            openFile={openFile}
            onOpenFile={setOpenFile}
          />
        </div>
      )}
      {shownTab === "activity" && (
        <div className="min-h-0 flex-1">
          <ActivityPane
            events={view?.events ?? []}
            running={running}
            steps={view?.steps ?? 0}
            costUsd={view?.costUsd ?? 0}
            turns={view?.turns ?? 0}
          />
        </div>
      )}
    </div>
  );

  const projectSheet = sheet === "more" && (
    <ProjectSheet
      project={project}
      fileCount={Object.keys(files).length}
      running={running}
      canPublish={!!publishSource && hasFiles}
      hasRepo={!!source.repo}
      canPullRequest={!!(view ?? project.workspaceId)}
      onShare={() => (user ? setDialog("builders") : setSheet("auth"))}
      onPush={() => void openDialog("push")}
      onPullRequest={() => void openDialog("pr")}
      onPublish={openPublish}
      onDownload={() => void downloadZip(files, `${slugOf(project.name)}.zip`)}
      onRemix={remix}
      onRename={() => setRenaming(project.name)}
      onDelete={() => deleteProject(project.id)}
      onClose={() => setSheet(null)}
    />
  );

  const dialogs = (
    <>
      {overlays}
      {projectSheet}
      {renaming !== null && (
        <Modal title="Rename project" icon={Pencil} onClose={() => setRenaming(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (renaming.trim())
                useProjects.getState().rename(project.id, renaming.trim().slice(0, 80));
              setRenaming(null);
            }}
            className="space-y-3"
          >
            <input
              autoFocus
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              className={`${inputClass} rounded-xl px-3 py-2.5 text-[14px]`}
            />
            <button
              type="submit"
              disabled={!renaming.trim()}
              className={`${primaryButton} w-full rounded-full py-2.5`}
            >
              Save
            </button>
          </form>
        </Modal>
      )}
      {dialog === "publish" && publishSource && (
        <Modal
          title={project.liveUrl ? "Update the live app" : "Publish"}
          icon={Rocket}
          onClose={() => setDialog(null)}
        >
          <div className="-mx-5 -mb-5 overflow-hidden">
            <PublishDialog
              project={project}
              files={publishSource}
              onClose={() => setDialog(null)}
            />
          </div>
        </Modal>
      )}
      {dialog === "builders" && (
        <BuildersDialog
          project={project}
          ensureWorkspace={ensureWorkspace}
          onClose={() => setDialog(null)}
        />
      )}
      {(dialog === "push" || dialog === "pr") && (
        <GithubDialog
          kind={dialog}
          project={project}
          workspaceId={view?.id ?? project.workspaceId ?? null}
          defaultTitle={lastUser?.text.slice(0, 70) ?? ""}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );

  const header = (
    <TopBar
      project={project}
      mobile={mobile}
      view={tab}
      onView={setTab}
      fileCount={Object.keys(files).length}
      running={running}
      building={!!building}
      shared={shared}
      canPublish={!!publishSource && hasFiles}
      chatOpen={chatOpen}
      onToggleChat={() => setChatOpen((v) => !v)}
      onMenu={() => setSheet("drawer")}
      onMore={() => setSheet("more")}
      onShare={() => (user ? setDialog("builders") : setSheet("auth"))}
      onPublish={openPublish}
    />
  );

  // A phone shows one thing at a time and switches with the tab bar at the
  // bottom, as Muse does. The preview stays mounted underneath, so switching
  // to the chat and back does not restart the app in it.
  if (mobile) {
    return (
      <div className="flex h-dvh flex-col">
        {header}
        <div className={cn("min-h-0 flex-1", pane !== "chat" && "hidden")}>{chat}</div>
        <div className={cn("min-h-0 flex-1", pane === "chat" && "hidden")}>{workbench}</div>
        <TabBar
          pane={pane}
          onPane={setPane}
          onMore={() => setSheet("more")}
          building={!!building}
          running={running}
        />
        {dialogs}
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col">
      {header}
      <SplitLayout
        className="min-h-0 flex-1"
        chat={chat}
        preview={workbench}
        chatCollapsed={!chatOpen}
      />
      {dialogs}
    </div>
  );
}
