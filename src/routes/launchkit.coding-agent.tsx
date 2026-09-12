import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Github,
  Loader2,
  Lock,
  Sparkles,
  Square,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { AppBuilderPage } from "@/components/appbuilder/AppBuilderPage";
import { cn } from "@/lib/utils";

// Pointing the coding agent at a repository you already have.
//
// The page holds no credential and does no work. It starts a run, polls it,
// and shows what came back. The token stays in an httpOnly cookie the page
// cannot read, the run happens on the runner, and opening the pull request is
// a separate deliberate act that goes back through the server.
//
// The one rule the layout is built around: nothing reaches GitHub until the
// diff has been seen. The button that opens the pull request does not exist
// until there is a finished run with files in it.

interface Repo {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  updatedAt: string;
}

interface AgentEvent {
  kind: string;
  message: string;
  tool?: string;
  at: string;
}

interface Job {
  id: string;
  repo: string;
  ref: string;
  goal: string;
  phase: "running" | "done" | "error" | "cancelled";
  status: string;
  summary: string;
  events: AgentEvent[];
  changedPaths: string[];
  deleted: string[];
  steps: number;
  costUsd: number;
  proposal: { title: string; body: string } | null;
  error: string | null;
}

export const Route = createFileRoute("/launchkit/coding-agent")({
  head: () => ({ meta: [{ title: "Coding Agent: DevStation" }] }),
  component: CodingAgent,
});

type Mode = "new" | "repo";

const MODE_KEY = "devstation.coding-agent.mode";

/**
 * One agent, two starting points.
 *
 * These were two pages, App Builder and Coding Agent, and they were the same
 * product: describe what you want, watch it get made, decide what happens to
 * the result. The only real difference is whether there is already a codebase.
 * Splitting that into two nav items made people choose a tool before they had
 * a problem, so it is one page with one choice at the top.
 */
function CodingAgent() {
  const [mode, setMode] = useState<Mode>("new");

  // Remembered, because people work one way for weeks at a time and being put
  // back on the other tab every visit is a small daily irritation.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODE_KEY);
      if (saved === "new" || saved === "repo") setMode(saved);
    } catch {
      /* storage disabled; the default is fine */
    }
  }, []);

  const choose = (next: Mode) => {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* as above */
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
        <ModeTab active={mode === "new"} onClick={() => choose("new")} icon={Sparkles}>
          Build something new
        </ModeTab>
        <ModeTab active={mode === "repo"} onClick={() => choose("repo")} icon={GitBranch}>
          Work on a repository
        </ModeTab>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {mode === "new" ? <AppBuilderPage /> : <RepoAgentPanel />}
      </div>
      <TerminalHint />
    </div>
  );
}

/** The same agent runs locally, and people who want that will not find out by
 *  reading the repository. One line, at the bottom, out of the way. */
function TerminalHint() {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border-t border-border px-3 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 font-mono text-[10px] text-meta hover:text-muted-foreground"
      >
        <Terminal className="h-3 w-3" />
        Run this in your own terminal
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <Command label="Install (needs nothing else)">
            curl -fsSL https://devstation.online/install.sh | sh
          </Command>
          <Command label="Or with npm">npm install -g @devstationlabs/cli</Command>
          <Command label="Then, in any project">devstation</Command>
          <p className="font-mono text-[10px] leading-relaxed text-meta">
            It needs ANTHROPIC_API_KEY or OPENROUTER_API_KEY. Run{" "}
            <span className="text-muted-foreground">devstation doctor</span> to see what is missing.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Command({ label, children }: { label: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(children)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      // A clipboard the browser will not give us is not worth an error toast:
      // the command is on screen and can be selected.
      .catch(() => undefined);
  };
  return (
    <div>
      <p className="font-mono text-[10px] text-meta">{label}</p>
      <button
        onClick={copy}
        title="Copy"
        className="mt-0.5 flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left font-mono text-[11px] text-muted-foreground hover:border-primary"
      >
        <span className="min-w-0 break-all">{children}</span>
        {copied ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
        ) : (
          <Copy className="h-3 w-3 shrink-0 text-meta" />
        )}
      </button>
    </div>
  );
}

function ModeTab({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-[11px]",
        active
          ? "bg-primary/10 text-primary"
          : "text-meta hover:bg-muted/40 hover:text-muted-foreground",
      )}
    >
      <Icon className="h-3 w-3" />
      {children}
    </button>
  );
}

/** Events worth showing. Token counts are tracked on every turn and are noise
 *  in a transcript; the cost is shown once, at the end, where it means
 *  something. */
const HIDDEN = new Set(["usage", "approval.requested"]);

const MARK: Record<string, { mark: string; className: string }> = {
  plan: { mark: "*", className: "text-primary" },
  "step.started": { mark: ">", className: "text-meta" },
  "step.completed": { mark: "+", className: "text-emerald-500" },
  "step.failed": { mark: "!", className: "text-destructive" },
  "approval.denied": { mark: "-", className: "text-amber-500" },
  verification: { mark: "=", className: "text-primary" },
  checkpoint: { mark: "#", className: "text-meta" },
  handoff: { mark: "?", className: "text-amber-500" },
  "task.completed": { mark: "+", className: "text-emerald-500" },
  "task.aborted": { mark: "!", className: "text-destructive" },
};

function RepoAgentPanel() {
  const [gh, setGh] = useState<{ configured: boolean; user: { login: string } | null } | null>(
    null,
  );
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [repo, setRepo] = useState("");
  const [goal, setGoal] = useState("");
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [base, setBase] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [opening, setOpening] = useState(false);
  const [pull, setPull] = useState<{ url: string; number: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const transcript = useRef<HTMLDivElement>(null);

  // A run outlives the page: that is the whole reason it happens on the runner
  // rather than in the tab. Remembering the id is what makes that true for the
  // person as well as for the server, so a refresh or a closed laptop lid
  // reattaches instead of losing a run that is still going.
  useEffect(() => {
    const remembered = readRememberedJob();
    if (!remembered) return;
    let alive = true;
    fetch(`/api/repo-agent?id=${encodeURIComponent(remembered)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; job?: Job }) => {
        if (!alive || !d.ok || !d.job) {
          forgetJob();
          return;
        }
        setJob(d.job);
        setRepo(d.job.repo);
        setGoal(d.job.goal);
        setBase(d.job.ref);
      })
      .catch(() => alive && forgetJob());
    return () => {
      alive = false;
    };
  }, []);

  // Who, if anyone, is signed in. The token itself is in an httpOnly cookie
  // and is deliberately unreadable from here.
  useEffect(() => {
    let alive = true;
    fetch("/api/github")
      .then((r) => r.json())
      .then((d) => alive && setGh(d))
      .catch(() => alive && setGh({ configured: false, user: null }));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!gh?.user) return;
    let alive = true;
    fetch("/api/repo-agent")
      .then((r) => r.json())
      .then((d: { ok: boolean; repos?: Repo[] }) => alive && setRepos(d.ok ? (d.repos ?? []) : []))
      .catch(() => alive && setRepos([]));
    return () => {
      alive = false;
    };
  }, [gh?.user]);

  // Polling, not streaming: the app deploys to a host that kills a function
  // after ten seconds, and a run takes minutes. Short polls are what let the
  // same code survive a refresh and a closed tab.
  useEffect(() => {
    if (!job || job.phase !== "running") return;
    let alive = true;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/repo-agent?id=${encodeURIComponent(job.id)}`);
        const data = (await res.json()) as { ok: boolean; job?: Job; message?: string };
        if (!alive) return;
        if (data.ok && data.job) setJob(data.job);
        else if (!data.ok) setError(data.message ?? "Lost track of that run.");
      } catch {
        // A dropped poll is not a failed run. The next one will catch up.
      }
    }, 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [job]);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight });
  }, [job?.events.length]);

  // The agent's own words for the pull request, once it has finished, unless
  // the person has started editing them.
  const touched = useRef(false);
  useEffect(() => {
    if (job?.phase !== "done" || !job.proposal || touched.current) return;
    setTitle(job.proposal.title);
    setBody(job.proposal.body);
  }, [job?.phase, job?.proposal]);

  const start = useCallback(async () => {
    setError(null);
    setPull(null);
    touched.current = false;
    setStarting(true);
    try {
      const res = await fetch("/api/repo-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "start", repo, goal }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        job?: Job;
        ref?: string;
        fileCount?: number;
        skipped?: number;
        message?: string;
      };
      if (!data.ok || !data.job) {
        setError(data.message ?? "Could not start.");
        return;
      }
      setBase(data.ref ?? "");
      setJob(data.job);
      rememberJob(data.job.id);
      toast.success(
        `Reading ${data.fileCount} file(s)` +
          (data.skipped ? `, ${data.skipped} left out as binary or too large` : ""),
      );
    } catch {
      setError("Could not reach the agent service.");
    } finally {
      setStarting(false);
    }
  }, [repo, goal]);

  const cancel = useCallback(async () => {
    if (!job) return;
    await fetch("/api/repo-agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", id: job.id }),
    }).catch(() => null);
  }, [job]);

  const openPull = useCallback(async () => {
    if (!job) return;
    setOpening(true);
    setError(null);
    try {
      const res = await fetch("/api/repo-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pull_request",
          id: job.id,
          repo: job.repo,
          base: base || job.ref,
          title,
          body,
        }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        pull?: { url: string; number: number };
        message?: string;
      };
      if (!data.ok || !data.pull) {
        setError(data.message ?? "The pull request was not opened.");
        return;
      }
      setPull(data.pull);
      forgetJob();
      toast.success(`Opened pull request #${data.pull.number}`);
    } catch {
      setError("Could not reach GitHub.");
    } finally {
      setOpening(false);
    }
  }, [job, base, title, body]);

  const running = job?.phase === "running";
  const changed = (job?.changedPaths.length ?? 0) + (job?.deleted.length ?? 0);

  if (gh && !gh.configured) {
    return (
      <Shell narrow>
        <Panel>
          <p className="font-mono text-[11px] text-meta">
            GitHub sign-in is not configured on this deployment. Set GITHUB_CLIENT_ID and
            GITHUB_CLIENT_SECRET to enable it.
          </p>
        </Panel>
      </Shell>
    );
  }

  if (gh && !gh.user) {
    return (
      <Shell narrow>
        <Panel>
          <p className="font-mono text-[11px] text-meta">
            Connect your GitHub account. The agent works on a copy of your repository and can never
            push to it: you decide whether its change becomes a pull request.
          </p>
          <a
            href="/api/github?start=1"
            className="mt-3 inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Github className="h-3 w-3" /> Connect GitHub
          </a>
        </Panel>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-4">
          <Panel title="Repository">
            <input
              list="repo-list"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={running}
              placeholder="owner/name"
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary disabled:opacity-50"
            />
            <datalist id="repo-list">
              {(repos ?? []).map((r) => (
                <option key={r.fullName} value={r.fullName}>
                  {r.private ? "private" : "public"} - updated{" "}
                  {new Date(r.updatedAt).toLocaleDateString()}
                </option>
              ))}
            </datalist>
            {repos === null ? (
              <p className="mt-2 font-mono text-[10px] text-meta">Loading your repositories...</p>
            ) : (
              <p className="mt-2 font-mono text-[10px] text-meta">
                {/* Said as "most recent" rather than a total: the listing is one
                    page, so a flat count would claim to know a number it does
                    not. Anything not listed can still be typed in. */}
                {repos.length === 0
                  ? "No repositories you can push to. Type one in anyway if you have access."
                  : `Your ${repos.length} most recently updated. Type any other in.`}
              </p>
            )}
          </Panel>

          <Panel title="What should it do">
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              disabled={running}
              rows={5}
              placeholder="Fix the failing test in src/total.test.js. Change the source, not the test."
              className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary disabled:opacity-50"
            />
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => void start()}
                disabled={running || starting || !repo.trim() || !goal.trim()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-[11px] text-primary-foreground disabled:opacity-40"
              >
                {starting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                {starting ? "Starting" : "Start"}
              </button>
              {running ? (
                <button
                  onClick={() => void cancel()}
                  className="flex items-center gap-1.5 rounded border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-destructive hover:text-destructive"
                >
                  <Square className="h-3 w-3" /> Stop
                </button>
              ) : null}
            </div>
            <p className="mt-3 flex items-start gap-1.5 font-mono text-[10px] leading-relaxed text-meta">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" />
              The agent works on a copy. It holds no GitHub credential and cannot push, comment or
              merge. Nothing reaches your repository until you open the pull request below.
            </p>
          </Panel>

          {error ? (
            <Panel>
              <p className="flex items-start gap-1.5 font-mono text-[11px] text-destructive">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                {error}
              </p>
            </Panel>
          ) : null}
        </div>

        <div className="space-y-4">
          <Panel
            title={job ? `${job.repo} at ${job.ref}` : "Transcript"}
            right={
              job ? (
                <span className="font-mono text-[10px] text-meta">
                  {job.phase === "running" ? job.status : job.phase}
                </span>
              ) : null
            }
          >
            {!job ? (
              <p className="font-mono text-[11px] text-meta">
                Pick a repository and say what you want done.
              </p>
            ) : (
              <>
                <div
                  ref={transcript}
                  className="max-h-[22rem] overflow-y-auto rounded border border-border bg-background p-2"
                >
                  {job.events.filter((e) => !HIDDEN.has(e.kind)).length === 0 ? (
                    <p className="font-mono text-[11px] text-meta">Working...</p>
                  ) : (
                    job.events
                      .filter((e) => !HIDDEN.has(e.kind))
                      .map((event, index) => {
                        const style = MARK[event.kind] ?? { mark: "-", className: "text-meta" };
                        return (
                          <div
                            key={`${event.at}-${index}`}
                            className="flex gap-1.5 py-0.5 font-mono text-[11px] leading-relaxed"
                          >
                            <span className={cn("shrink-0", style.className)}>{style.mark}</span>
                            {event.tool ? (
                              <span className="shrink-0 text-meta">{event.tool}</span>
                            ) : null}
                            <span className="min-w-0 break-words text-muted-foreground">
                              {event.message}
                            </span>
                          </div>
                        );
                      })
                  )}
                </div>
                {job.phase !== "running" ? (
                  <p className="mt-2 font-mono text-[10px] text-meta">
                    {job.steps} step(s), {changed} file(s) changed, about ${job.costUsd.toFixed(2)}
                  </p>
                ) : null}
                {job.error ? (
                  <p className="mt-2 font-mono text-[11px] text-destructive">{job.error}</p>
                ) : null}
              </>
            )}
          </Panel>

          {job?.phase === "done" && changed === 0 ? (
            <Panel title="Nothing changed">
              <p className="font-mono text-[11px] text-meta">
                The run finished without changing a file, so there is no pull request to open.
              </p>
              {job.summary ? (
                <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                  {job.summary}
                </p>
              ) : null}
            </Panel>
          ) : null}

          {job?.phase === "done" && changed > 0 && !pull ? (
            <Panel title="Open a pull request">
              <div className="mb-3 space-y-1">
                {job.changedPaths.map((path) => (
                  <div key={path} className="font-mono text-[11px] text-muted-foreground">
                    <span className="text-emerald-500">M</span> {path}
                  </div>
                ))}
                {job.deleted.map((path) => (
                  <div key={path} className="font-mono text-[11px] text-muted-foreground">
                    <span className="text-destructive">D</span> {path}
                  </div>
                ))}
              </div>

              <label className="font-mono text-[10px] text-meta">Title</label>
              <input
                value={title}
                onChange={(e) => {
                  touched.current = true;
                  setTitle(e.target.value);
                }}
                className="mb-2 w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary"
              />
              <label className="font-mono text-[10px] text-meta">Description</label>
              <textarea
                value={body}
                onChange={(e) => {
                  touched.current = true;
                  setBody(e.target.value);
                }}
                rows={8}
                className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] outline-none focus:border-primary"
              />
              <p className="mt-2 font-mono text-[10px] text-meta">
                Onto a new branch, against {base || job.ref}. Nothing existing is moved or
                overwritten.
              </p>
              <button
                onClick={() => void openPull()}
                disabled={opening || !title.trim()}
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-[11px] text-primary-foreground disabled:opacity-40"
              >
                {opening ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <GitPullRequest className="h-3 w-3" />
                )}
                {opening ? "Opening" : "Open pull request"}
              </button>
            </Panel>
          ) : null}

          {pull ? (
            <Panel title="Opened">
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center gap-1.5 font-mono text-[11px] text-primary hover:underline"
              >
                <Check className="h-3 w-3" /> Pull request #{pull.number}
                <ExternalLink className="h-3 w-3" />
              </a>
              <p className="mt-2 font-mono text-[10px] text-meta">
                Nothing has been merged. Review it as you would any other change.
              </p>
            </Panel>
          ) : null}
        </div>
      </div>
    </Shell>
  );
}

const JOB_KEY = "devstation.coding-agent.job";

function rememberJob(id: string) {
  try {
    localStorage.setItem(JOB_KEY, id);
  } catch {
    // Private browsing, or storage disabled. Losing the reattach is a smaller
    // problem than failing to start the run.
  }
}

function readRememberedJob(): string | null {
  try {
    return localStorage.getItem(JOB_KEY);
  } catch {
    return null;
  }
}

function forgetJob() {
  try {
    localStorage.removeItem(JOB_KEY);
  } catch {
    /* as above */
  }
}

function Shell({ children, narrow = false }: { children: React.ReactNode; narrow?: boolean }) {
  return (
    <div className={cn("space-y-4", narrow && "max-w-2xl")}>
      <PageHeader
        breadcrumb={["LaunchKit"]}
        title="Coding Agent"
        subtitle="Point it at a repository you already have. It reads, edits and verifies, then proposes a pull request you decide on."
      />
      {children}
    </div>
  );
}

function Panel({
  title,
  right,
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded border border-border bg-card p-3">
      {title ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="font-mono text-[11px] uppercase tracking-wide text-meta">{title}</h2>
          {right}
        </div>
      ) : null}
      {children}
    </section>
  );
}
