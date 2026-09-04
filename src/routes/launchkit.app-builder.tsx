import { createFileRoute } from "@tanstack/react-router";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Download,
  ExternalLink,
  FileCode2,
  Link2,
  Loader2,
  Pencil,
  Rocket,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PreviewFrame } from "@/components/appbuilder/PreviewFrame";
import { AttachContract } from "@/components/appbuilder/AttachContract";
import { SplitLayout } from "@/components/appbuilder/SplitLayout";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { chainConfig, nativeSymbol } from "@/lib/chains";
import { generateApp } from "@/lib/appgen/generate";
import { buildConfigured, runBuildJob } from "@/lib/appgen/build";
import { blankScaffold } from "@/lib/appgen/prompt";
import { runTurn } from "@/lib/appgen/session";
import { nameFromPrompt, onProjectsWriteError, useProjects } from "@/lib/appgen/projects";
import { validateApp } from "@/lib/appgen/validate";
import type { PreviewError } from "@/lib/appgen/preview";
import type { ResolvedAbi } from "@/lib/appgen/abi-source";
import { downloadZip } from "@/lib/appgen/zip";
import { isAiConfigured } from "@/lib/ai-settings";
import { useAgentJob, type AgentJob, type PendingDecision } from "@/hooks/useAgentJob";
import type { ChatMessage } from "@/lib/ai";

export const Route = createFileRoute("/launchkit/app-builder")({
  head: () => ({ meta: [{ title: "App Builder — DevStation" }] }),
  // Gated on the shared map, never on a flag local to this file: the
  // sidebar badge reads the same entry, so the two cannot disagree.
  // AppBuilderPage stays referenced, so removing the map entry is all it takes
  // to bring the page back.
  component: () =>
    isComingSoon("/launchkit/app-builder") ? (
      <ComingSoon path="/launchkit/app-builder" />
    ) : (
      <AppBuilderPage />
    ),
});

/**
 * The question a paused turn is waiting on.
 *
 * Rendered in the transcript rather than as a modal on purpose: a modal steals
 * focus and has to be answered now, and the whole point of a durable pause is
 * that it can be left and come back to. Refresh the page and this is still
 * here.
 */
function DecisionCard({
  decision,
  answering,
  onAnswer,
}: {
  decision: PendingDecision;
  answering: boolean;
  onAnswer: (optionId: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!decision.expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [decision.expiresAt]);

  const left = decision.expiresAt ? Math.max(0, decision.expiresAt - now) : null;
  const lapsed = left !== null && left === 0;

  return (
    <div className="mr-2 rounded border border-warning/50 bg-warning/5 p-2 font-mono text-[11px]">
      <span className="mb-1 flex items-center gap-1 text-warning">
        <ShieldQuestion className="h-3 w-3" /> needs your permission
      </span>
      <p className="whitespace-pre-wrap break-words text-foreground">{decision.question}</p>
      {decision.consequences && (
        <p className="mt-1 text-[10px] text-muted-foreground">{decision.consequences}</p>
      )}
      {decision.affectedAction && (
        <p className="mt-1 text-[10px] text-meta">{decision.affectedAction}</p>
      )}
      {left !== null && (
        <p className="mt-1 text-[10px] text-meta">
          {lapsed
            ? "This request has expired."
            : `Expires in ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        {(decision.options ?? []).map((o) => (
          <button
            key={o.id}
            type="button"
            // The stable id, never the label. A reworded button must not change
            // what the answer means.
            onClick={() => onAnswer(o.id)}
            disabled={answering || lapsed}
            className={
              o.value === "approve"
                ? "rounded border border-border bg-surface-2 px-2 py-1 text-[10px] text-foreground disabled:opacity-50"
                : "rounded border border-border px-2 py-1 text-[10px] text-muted-foreground disabled:opacity-50"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** An outward action the agent asked for and you allowed.
 *
 *  Carried out HERE, in the browser, and never by the runner. The GitHub token
 *  is in an httpOnly cookie this session owns, the publish route is keyed to
 *  the connected wallet, and neither ever reaches the machine the agent runs
 *  on. Approving does not hand the agent a credential; it hands the action back
 *  to the person who has one. */
async function performHandoff(
  handoff: { name: string; args: Record<string, unknown> },
  files: Record<string, string>,
  wallet: string | undefined,
): Promise<{ ok: boolean; message: string; repoUrl?: string; liveUrl?: string }> {
  // Paths are stored with the workspace prefix and published without it.
  const payload: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    payload[path.replace(/^app\//, "")] = content;
  }
  if (Object.keys(payload).length === 0) {
    return { ok: false, message: "There was nothing to send." };
  }

  if (handoff.name === "push_to_github") {
    const res = await fetch("/api/github/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        repoName: String(handoff.args.repoName ?? ""),
        isPrivate: handoff.args.isPrivate !== false,
        files: payload,
        message: typeof handoff.args.message === "string" ? handoff.args.message : undefined,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      repo?: { url?: string; owner?: string; name?: string };
    } | null;
    if (body?.ok && body.repo?.url) {
      return {
        ok: true,
        message: `Pushed to ${body.repo.owner}/${body.repo.name}.`,
        repoUrl: body.repo.url,
      };
    }
    // GitHub's own wording is the useful one; the route passes it through.
    return { ok: false, message: body?.message ?? "The push failed." };
  }

  if (handoff.name === "publish_app") {
    if (!wallet) return { ok: false, message: "Connect a wallet to publish." };
    const res = await fetch("/api/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: String(handoff.args.slug ?? ""),
        files: payload,
        owner: wallet,
      }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      url?: string;
      message?: string;
    } | null;
    if (body?.ok && body.url)
      return { ok: true, message: `Published to ${body.url}`, liveUrl: body.url };
    return { ok: false, message: body?.message ?? "Publishing failed." };
  }

  return { ok: false, message: `Nothing here knows how to do "${handoff.name}".` };
}

interface Turn {
  role: "user" | "assistant";
  text: string;
  changed?: string[];
  failed?: boolean;
  /** Still streaming — rendered live rather than after the fact. */
  live?: boolean;
}

/** Index of the turn currently being streamed into. Written out rather than
 *  using Array.findLastIndex, which is newer than this project's TS lib. */
function liveIndex(turns: Turn[]): number {
  for (let i = turns.length - 1; i >= 0; i--) if (turns[i].live) return i;
  return -1;
}

function AppBuilderPage() {
  const { chainId } = useActiveChain();
  const writeFiles = useWorkspaceStore((s) => s.writeFiles);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const { address: wallet, isConnected } = useAccount();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [attached, setAttached] = useState<ResolvedAbi | null>(null);
  const [previewErrors, setPreviewErrors] = useState<PreviewError[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  /** The built site, when a build runner produced one. The preview renders
   *  this rather than the sources, so what is on screen is what ships. */
  const [dist, setDist] = useState<Record<string, string> | null>(null);
  /** The shown build predates the current turn — still worth looking at, but
   *  no longer what the code says. */
  const [stale, setStale] = useState(false);
  const [buildNote, setBuildNote] = useState<string | null>(null);
  // Collapsed chat gives the preview the whole window — the point of building
  // an app is looking at it.
  const abortRef = useRef<AbortController | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  /** Latest turns, for saving without making every callback depend on them. */
  const turnsRef = useRef<Turn[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data: hosting } = useQuery({
    queryKey: ["apps-deploy-configured"],
    queryFn: async () => {
      const r = await fetch("/api/apps-deploy");
      return r.ok ? ((await r.json()) as { configured: boolean }) : { configured: false };
    },
    staleTime: 60_000,
    retry: false,
  });

  // Whether this deployment can build at all. It decides which kind of
  // project is generated, so it has to be known before the first turn.
  const { data: canBuild } = useQuery({
    queryKey: ["build-configured"],
    queryFn: buildConfigured,
    staleTime: Infinity,
    retry: false,
  });
  const target = canBuild ? ("vite" as const) : ("esm" as const);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, status]);

  // Restore the active project, or start one. Done after mount so the server
  // and the first client render agree; until then the builder shows its empty
  // state, which is what a brand-new project looks like anyway.
  const [loadedProject, setLoadedProject] = useState<string | null>(null);
  useEffect(() => {
    useProjects.getState().hydrate();
    const id = useProjects.getState().activeId;
    // Deliberately does NOT create one. Creating on mount meant opening the
    // builder from the sidebar and leaving behind an empty "Untitled app" in
    // the list, every time. A project is created on the first turn that
    // produces something worth keeping.
    if (!id || loadedProject === id) return;
    const project = useProjects.getState().projects.find((x) => x.id === id);
    if (project) {
      if (Object.keys(project.files).length > 0) setFiles(project.files);
      if (project.history.length > 0) setHistory(project.history);
      if (project.turns.length > 0) setTurns(project.turns as Turn[]);
      // Without these two, reopening a project showed a blank preview and had
      // silently lost its contract binding.
      if (project.dist) {
        setDist(project.dist);
        setStale(false);
      }
      if (project.attached) setAttached(project.attached as unknown as ResolvedAbi);
    }
    setLoadedProject(id);
  }, [loadedProject]);

  useEffect(() => {
    turnsRef.current = turns;
  }, [turns]);

  const projectList = useProjects((s) => s.projects);
  const activeProjectId = useProjects((s) => s.activeId);

  // A turn started here runs in the build runner, not in this tab, so a refresh
  // reattaches to it instead of killing it. When one finishes — possibly in a
  // page that never saw it start — its result is applied exactly as a local
  // turn's would be.
  const applyAgentResult = useCallback(
    (job: AgentJob) => {
      setBusy(false);
      setStatus(null);
      if (job.phase === "error") {
        setTurns((t) => {
          const next = [...t];
          const i = liveIndex(next);
          const failed: Turn = {
            role: "assistant",
            text: job.error || "That failed.",
            failed: true,
          };
          if (i >= 0) next[i] = failed;
          else next.push(failed);
          return next;
        });
        return;
      }
      if (job.phase === "cancelled" && job.buildNote) {
        // Declined permission, or a question nobody answered in time. Both are
        // real outcomes and the user should see which.
        setTurns((t) => {
          const next = [...t];
          const i = liveIndex(next);
          const stopped: Turn = { role: "assistant", text: job.buildNote as string };
          if (i >= 0) next[i] = stopped;
          else next.push(stopped);
          return next;
        });
        return;
      }
      if (job.phase !== "done") return;
      // Object.keys, not truthiness: {} is truthy, so a conversational turn was
      // setting files to an empty app, which then failed validation with
      // "There is no index.html" for something never built.
      if (job.files && Object.keys(job.files).length > 0) {
        setFiles(job.files);
        writeFiles(Object.entries(job.files).map(([path, content]) => ({ path, content })));
      }
      if (job.history?.length) setHistory(job.history);
      if (job.dist) {
        setDist(job.dist);
        setStale(false);
      }
      setPreviewErrors([]);
      useProjects.getState().save({
        ...(job.files ? { files: job.files } : {}),
        ...(job.history?.length ? { history: job.history } : {}),
        ...(job.dist ? { dist: job.dist } : {}),
      });
      setTurns((t) => {
        const next = [...t];
        const i = liveIndex(next);
        const finished: Turn = {
          role: "assistant",
          text:
            job.prose ||
            (job.changed.length ? `Updated ${job.changed.length} file(s).` : "Done.") +
              (job.removed?.length ? ` Removed ${job.removed.length} file(s).` : ""),
          changed: job.changed,
        };
        if (i >= 0) next[i] = finished;
        else next.push(finished);
        return next;
      });
      setTimeout(() => useProjects.getState().save({ turns: turnsRef.current }), 0);

      // Anything the agent asked for and you allowed is carried out HERE, now
      // that the turn has finished. The runner recorded the approval and could
      // not act on it: it has no GitHub cookie, no publish wallet and no
      // reason to be given either.
      const handoffs = job.handoffs ?? [];
      if (handoffs.length > 0) {
        const source = job.files ?? {};
        void (async () => {
          for (const handoff of handoffs) {
            const result = await performHandoff(handoff, source, wallet);
            // Reported in the transcript rather than only as a toast: this is
            // the outcome of something you approved, and it should still be
            // there when you come back to the conversation.
            setTurns((t) => [
              ...t,
              { role: "assistant", text: result.message, failed: !result.ok },
            ]);
            if (result.repoUrl) {
              const [owner, name] = new URL(result.repoUrl).pathname.slice(1).split("/");
              useProjects.getState().save({
                repo: { owner, name, url: result.repoUrl, pushedAt: Date.now() },
              });
            }
            if (result.liveUrl) {
              setLiveUrl(result.liveUrl);
              useProjects.getState().save({ liveUrl: result.liveUrl });
            }
            if (result.ok) toast.success(result.message);
            else toast.error(result.message);
          }
          setTimeout(() => useProjects.getState().save({ turns: turnsRef.current }), 0);
        })();
      }
    },
    [writeFiles, wallet],
  );

  const agent = useAgentJob(activeProjectId, applyAgentResult);

  // Mirror a running job into the UI. This is what makes a refreshed page pick
  // up mid-build: the status line, the streaming prose and the file list all
  // come from the job, not from a stream this tab is holding.
  useEffect(() => {
    const job = agent.job;
    if (job?.phase === "awaiting_decision") {
      // Waiting on a person is not the agent working. Leaving `busy` true here
      // would spin a loader under a question nobody is answering yet.
      setBusy(false);
      setStatus(null);
      return;
    }
    if (!job || job.phase !== "running") return;
    setBusy(true);
    setStatus(job.status || "Working…");
    setTurns((t) => {
      const next = [...t];
      const i = liveIndex(next);
      if (i >= 0) {
        next[i] = { ...next[i], text: job.prose, changed: job.changed };
        return next;
      }
      // Resumed in a fresh page: there is no placeholder turn yet.
      return [...next, { role: "assistant", text: job.prose, changed: job.changed, live: true }];
    });
  }, [agent.job]);
  const activeProject = projectList.find((p) => p.id === activeProjectId) ?? null;

  const commitName = () => {
    if (activeProjectId && nameDraft.trim()) {
      useProjects.getState().rename(activeProjectId, nameDraft);
    }
    setRenaming(false);
  };

  // Storage failures reach the user instead of silently losing work.
  useEffect(() => {
    onProjectsWriteError((message) => toast.error(message));
    return () => onProjectsWriteError(null);
  }, []);

  // An empty workspace is not a broken app — it is one that has not been built
  // yet, and telling someone their nonexistent app is missing index.html is
  // noise they cannot act on.
  const issues = useMemo(
    () => (files && Object.keys(files).length > 0 ? validateApp(files, "app", target) : []),
    [files, target],
  );
  const fatal = issues.filter((i) => i.fatal);

  // What the preview shows. A built project is previewed from its build
  // output, because that is what actually ships — and because its sources
  // import bare specifiers ("preact", "viem") that only a bundler resolves, so
  // there is nothing to show until it has been built.
  const previewFiles = dist ?? (target === "esm" ? files : null);
  const emptyPreviewMessage = !files
    ? "Your app will appear here."
    : buildNote
      ? buildNote
      : "The build did not finish, so there is nothing to show yet. Say what went wrong above and it will be fixed.";

  const send = useCallback(
    async (forced?: "review") => {
      const prompt = input.trim();
      if (!prompt || busy) return;
      // Asking to "check this over" and getting an unrequested rewrite is the
      // behaviour that makes an agent feel careless, so a question is read as a
      // question. The button is the explicit way in.
      // Left undefined on purpose: the turn reads the message and decides.
      // Routing here on a regular expression is what made "hello" say
      // "Planning the app…" before the model had been asked anything.
      const mode = forced;
      if (!isAiConfigured()) {
        toast.error("Add an API key in AI settings first.");
        return;
      }
      setInput("");
      // A placeholder assistant turn that fills in as the model works, so the
      // chat reads as progress rather than a spinner and then a wall of text.
      setTurns((t) => [
        ...t,
        { role: "user", text: prompt },
        { role: "assistant", text: "", changed: [], live: true },
      ]);
      setBusy(true);

      // Create the project HERE — on the first prompt, before anything can try
      // to save into it. Creating it on mount left an empty "Untitled app"
      // behind every time the builder was merely opened; creating it after the
      // turn meant the build finished with no project to save into, so the
      // preview was silently never persisted.
      if (!useProjects.getState().activeId) {
        setLoadedProject(useProjects.getState().create(nameFromPrompt(prompt), wallet ?? null));
      }
      // The previous build is deliberately LEFT on screen while the next one
      // runs. Blanking it here meant the app you were looking at vanished the
      // moment you asked for a change and stayed gone for the minutes a build
      // takes — the worst possible moment to lose sight of what you have. It is
      // marked stale instead, and replaced the moment a new build lands.
      if (mode !== "review") {
        setBuildNote(null);
      }
      // Prefer a runner-hosted turn. It survives this page: refresh, close the
      // tab, come back later, and the build is still going. The in-page path
      // below stays for when no runner is configured.
      if (agent.configured) {
        const projectId = useProjects.getState().activeId;
        if (projectId) {
          const started = await agent.start({
            projectId,
            prompt,
            files: files ?? {},
            history,
            mode,
            // Binds any grant a decision produces to this wallet. Absent when
            // no wallet is connected, and left absent rather than faked.
            owner: wallet,
            context: attached
              ? {
                  target,
                  contract: {
                    address: attached.address,
                    chainId: attached.chainId,
                    chainName: chainConfig(attached.chainId).name,
                    rpcUrl: chainConfig(attached.chainId).rpcUrl,
                    explorerUrl: chainConfig(attached.chainId).explorerUrl,
                    nativeSymbol: nativeSymbol(attached.chainId),
                    abi: attached.abi,
                  },
                }
              : { target },
          });
          if (started) return;
          // Falling through on failure is deliberate: a runner that cannot be
          // reached should degrade to building in the page, not to nothing.
        }
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        // First turn starts from a runnable scaffold — with the contract's
        // binding baked in when one is attached — so even a partial reply
        // leaves something that loads.
        const base =
          files ??
          (attached
            ? generateApp({
                abi: attached.abi,
                address: attached.address,
                contractName: attached.name,
                chainId: attached.chainId,
                chainName: chainConfig(attached.chainId).name,
                rpcUrl: chainConfig(attached.chainId).rpcUrl,
                explorerUrl: chainConfig(attached.chainId).explorerUrl,
                nativeSymbol: nativeSymbol(attached.chainId),
                target,
              })
            : blankScaffold("app", target));

        const result = await runTurn({
          prompt,
          mode,
          files: base,
          history,
          previewErrors,
          signal: controller.signal,
          // The status line is whatever the agent says it is doing. Both
          // surfaces carry the same text, so the label can never contradict
          // the event.
          onProgress: (e) => setStatus(e.message),
          onStatus: setStatus,
          onProse: (text) =>
            setTurns((t) => {
              const next = [...t];
              const i = liveIndex(next);
              if (i >= 0) next[i] = { ...next[i], text };
              return next;
            }),
          onFile: (path) => {
            // Stale from the moment a file actually changes, not from the
            // moment a message was sent — a greeting must not grey out a
            // working preview.
            setStale(true);
            setTurns((t) => {
              const next = [...t];
              const i = liveIndex(next);
              if (i >= 0) {
                next[i] = { ...next[i], changed: [...new Set([...(next[i].changed ?? []), path])] };
              }
              return next;
            });
          },
          // When there is a runner, every turn ends with the project installed,
          // linted, built and driven in a real browser. Anything that fails
          // comes back to the model as another message, the same way a
          // validation error already does.
          runBuild:
            canBuild && mode !== "review"
              ? async (current) => {
                  const outcome = await runBuildJob(current, { signal: controller.signal });
                  setBuildNote(outcome.unavailable ?? null);
                  if (outcome.dist) {
                    setDist(outcome.dist);
                    setStale(false);
                    // Persisted here, where it arrives: without it, reopening a
                    // project showed a blank preview, and a Vite project cannot
                    // be previewed from source at all.
                    useProjects.getState().save({ dist: outcome.dist });
                  }
                  return outcome;
                }
              : undefined,
          context: attached
            ? {
                target,
                contract: {
                  address: attached.address,
                  chainId: attached.chainId,
                  chainName: chainConfig(attached.chainId).name,
                  rpcUrl: chainConfig(attached.chainId).rpcUrl,
                  explorerUrl: chainConfig(attached.chainId).explorerUrl,
                  nativeSymbol: nativeSymbol(attached.chainId),
                  abi: attached.abi,
                },
              }
            : { target },
        });

        setFiles(result.files);
        setHistory(result.history);
        // Persist immediately: a build takes minutes, and a closed tab is the
        // most expensive possible moment to lose one.
        useProjects.getState().save({
          files: result.files,
          history: result.history,
          attached: attached
            ? {
                address: attached.address,
                chainId: attached.chainId,
                name: attached.name,
                abi: attached.abi,
              }
            : null,
        });
        // Saved on the next tick so the finished turn, not the streaming
        // placeholder, is what gets stored.
        setTimeout(() => {
          useProjects.getState().save({ turns: turnsRef.current });
        }, 0);
        setPreviewErrors([]); // the app changed; old errors no longer apply
        writeFiles(Object.entries(result.files).map(([path, content]) => ({ path, content })));
        setTurns((t) => {
          const next = [...t];
          const i = liveIndex(next);
          const finished: Turn = {
            role: "assistant",
            text:
              result.reply ||
              (result.changed.length ? `Updated ${result.changed.length} file(s).` : "Done."),
            changed: result.changed,
            failed: result.issues.some((x) => x.fatal),
          };
          if (i >= 0) next[i] = finished;
          else next.push(finished);
          return next;
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setTurns((t) => [
            ...t,
            {
              role: "assistant",
              text: e instanceof Error ? e.message : "That failed.",
              failed: true,
            },
          ]);
        }
      } finally {
        setBusy(false);
        setStatus(null);
        abortRef.current = null;
      }
    },
    [input, busy, files, history, attached, previewErrors, writeFiles, canBuild, target, agent],
  );

  const publish = useCallback(async () => {
    if (!files) return;
    if (!wallet) {
      toast.error("Connect a wallet — publishing is rate limited per wallet.");
      return;
    }
    setDeploying(true);
    setLiveUrl(null);
    try {
      // Publish what actually runs. For a Vite project that is the built
      // output, not the source — publishing src/app.js would put a page on the
      // internet that cannot load. `dist` is already the built result when the
      // runner has produced one.
      const source = dist ?? files;
      const payload: Record<string, string> = {};
      for (const [path, content] of Object.entries(source)) {
        payload[path.replace(/^app\//, "")] = content;
      }

      // Prefer a DevStation subdomain. It is free, instant, and the name is the
      // project's own. Netlify remains the fallback for when the runner that
      // hosts these is unreachable.
      const slug = (useProjects.getState().projects.find((p) => p.id === activeProjectId)?.name ??
        "app") as string;
      const own = await fetch("/api/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, files: payload, owner: wallet }),
      }).catch(() => null);
      if (own) {
        const body = (await own.json().catch(() => null)) as {
          ok?: boolean;
          url?: string;
          message?: string;
        } | null;
        if (body?.ok && body.url) {
          setLiveUrl(body.url);
          useProjects.getState().save({ liveUrl: body.url });
          toast.success("Published");
          return;
        }
        // A name clash or an invalid name is the user's to resolve, not
        // something to silently work around by publishing elsewhere.
        if (body?.message && own.status === 400) {
          toast.error(body.message);
          return;
        }
      }

      const res = await fetch("/api/apps-deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: payload, requesterAddress: wallet }),
      });
      const json = (await res.json()) as { ok: boolean; url?: string; message?: string };
      if (!json.ok) {
        toast.error(json.message ?? "Publish failed");
        return;
      }
      setLiveUrl(json.url ?? null);
      toast.success("Published");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Publish failed");
    } finally {
      setDeploying(false);
    }
  }, [files, dist, wallet, activeProjectId]);

  const reset = () => {
    setTurns([]);
    setHistory([]);
    setFiles(null);
    setPreviewErrors([]);
    setLiveUrl(null);
  };

  const chat = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        {/* Which project you are in, and the ability to name it, without
            leaving the builder. Previously the builder never said which app
            was open — you clicked "Tip Jar" in My Apps and landed on an
            unlabelled page. */}
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setRenaming(false);
            }}
            className="mr-2 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 py-0.5 font-mono text-xs text-foreground focus:outline-none"
          />
        ) : (
          <button
            onClick={() => {
              if (!activeProject) return;
              setNameDraft(activeProject.name);
              setRenaming(true);
            }}
            title={activeProject ? "Rename this app" : undefined}
            className="group flex min-w-0 items-center gap-1.5 text-left"
          >
            <span className="truncate font-mono text-xs font-bold text-foreground">
              {activeProject?.name ?? "App Builder"}
            </span>
            {activeProject && (
              <Pencil className="h-3 w-3 shrink-0 text-meta opacity-0 transition group-hover:opacity-100" />
            )}
          </button>
        )}
        <div className="flex items-center gap-2">
          <AttachContract chainId={chainId} attached={attached} onAttach={setAttached} />
          {turns.length > 0 && (
            <button
              onClick={reset}
              title="Start over"
              className="text-meta transition hover:text-foreground"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {turns.length === 0 && (
          <div className="space-y-2 pt-6 text-center font-mono text-[11px] text-meta">
            <p className="text-sm text-muted-foreground">What do you want to build?</p>
            <p>Describe an app. It runs here as you go.</p>
            <p className="pt-2">Then keep talking to change it.</p>
          </div>
        )}
        {turns.map((t, i) => (
          <div
            key={i}
            className={
              t.role === "user"
                ? "ml-6 rounded border border-border bg-surface-2 p-2 font-mono text-[11px] text-foreground"
                : "mr-2 font-mono text-[11px] text-muted-foreground"
            }
          >
            {t.failed && (
              <span className="mb-1 flex items-center gap-1 text-warning">
                <TriangleAlert className="h-3 w-3" /> needs another pass
              </span>
            )}
            <p className="whitespace-pre-wrap break-words">{t.text}</p>
            {t.changed && t.changed.length > 0 && (
              <p className="mt-1 text-[10px] text-meta">
                {t.changed.map((c) => c.replace(/^app\//, "")).join(" · ")}
              </p>
            )}
            {t.live && status && (
              <p className="mt-1 flex items-center gap-1.5 text-[10px] text-meta">
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> {status}
              </p>
            )}
          </div>
        ))}
        {agent.decision && (
          <DecisionCard
            decision={agent.decision}
            answering={agent.answering}
            onAnswer={(optionId) => void agent.answer(agent.decision!.id, optionId)}
          />
        )}
        {status && !turns.some((t) => t.live) && (
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-meta">
            <Loader2 className="h-3 w-3 animate-spin" /> {status}
          </p>
        )}
      </div>

      {fatal.length > 0 && (
        <button
          onClick={() => setInput("The preview is broken — fix it.")}
          className="mx-3 mb-2 rounded border border-danger/40 bg-danger/10 p-2 text-left font-mono text-[10px] text-danger"
        >
          {fatal[0].message} — click to ask for a fix
        </button>
      )}

      <div className="border-t border-border p-2">
        {files && (
          <div className="mb-1.5 flex items-center gap-2">
            <button
              onClick={() => void send("review")}
              disabled={busy || !input.trim()}
              title="Read the code over and report what it finds — changes nothing"
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground transition hover:border-info hover:text-info disabled:opacity-40"
            >
              <ShieldCheck className="h-3 w-3" /> Review code
            </button>
            <span className="font-mono text-[10px] text-meta">reports findings, edits nothing</span>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            placeholder={
              turns.length === 0
                ? "Build me a token swap interface…"
                : "Add a wallet connect button…"
            }
            className="flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
          />
          {busy ? (
            <button
              onClick={() => abortRef.current?.abort()}
              title="Stop"
              className="rounded bg-surface-2 p-2 text-muted-foreground hover:text-foreground"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={!input.trim()}
              title="Send"
              className="rounded bg-primary p-2 text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const preview = (
    <div className="flex h-full min-h-0 flex-col">
      {files && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
          <button
            onClick={() => setShowFiles((v) => !v)}
            className="inline-flex items-center gap-1 font-mono text-[10px] text-meta hover:text-foreground"
          >
            <FileCode2 className="h-3 w-3" /> {Object.keys(files).length} files
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void downloadZip(files, "dapp.zip")}
              className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
            >
              <Download className="h-3 w-3" /> Download
            </button>
            {hosting?.configured && (
              <button
                onClick={() => void publish()}
                disabled={deploying}
                className="inline-flex items-center gap-1 rounded border border-primary px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/10 disabled:opacity-40"
              >
                {deploying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Rocket className="h-3 w-3" />
                )}
                Publish
              </button>
            )}
            {liveUrl && (
              <a
                href={liveUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-success"
              >
                <ExternalLink className="h-3 w-3" /> live
              </a>
            )}
          </div>
        </div>
      )}

      {showFiles && files && (
        <div className="max-h-40 overflow-y-auto border-b border-border bg-surface p-2">
          {Object.keys(files).map((p) => (
            <button
              key={p}
              onClick={() => openFile(p)}
              className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[10px] text-meta hover:bg-surface-2 hover:text-foreground"
            >
              <Link2 className="h-2.5 w-2.5 shrink-0" /> {p}
            </button>
          ))}
        </div>
      )}

      {/* Deliberately not gated on `busy`. When a build FAILS, busy goes false
          and stale stays true — so gating on it removed the warning while the
          out-of-date preview stayed on screen, which is the one moment the
          warning matters most. */}
      {stale && dist && (
        <div className="flex items-center gap-1.5 border-b border-warning/40 bg-warning/10 px-3 py-1 font-mono text-[10px] text-warning">
          {busy ? (
            <>
              <Loader2 className="h-2.5 w-2.5 shrink-0 animate-spin" />
              Showing the previous build while the new one runs.
            </>
          ) : (
            <>
              <TriangleAlert className="h-2.5 w-2.5 shrink-0" />
              This preview is from an earlier build — the code has changed since.
            </>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {previewFiles ? (
          <PreviewFrame
            files={previewFiles}
            dir={dist ? "" : "app"}
            chainName={chainConfig(attached?.chainId ?? chainId).name}
            onError={(e) => setPreviewErrors((prev) => [...prev, e].slice(-20))}
            className="flex h-full flex-col"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-meta">
            {emptyPreviewMessage}
          </div>
        )}
      </div>
    </div>
  );

  // Wallet-gated. Every project is stored against a wallet, publishing and
  // reputation are wallet-scoped, and an app built with no wallet connected
  // has nowhere to be saved — so the builder asks for one up front rather
  // than letting a build finish and then losing it.
  if (!isConnected) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-sm rounded border border-dashed border-border p-12 text-center">
          <ShieldCheck className="mx-auto h-6 w-6 text-meta" />
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            Connect a wallet to use the App Builder.
          </p>
          <p className="mt-1 font-mono text-[10px] text-meta">
            Your apps are saved against your wallet, so you can reopen and publish them later.
          </p>
        </div>
      </div>
    );
  }

  return <SplitLayout chat={chat} preview={preview} />;
}
