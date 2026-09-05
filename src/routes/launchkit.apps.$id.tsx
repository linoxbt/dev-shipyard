import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import {
  Check,
  Code2,
  ExternalLink,
  FileCode2,
  Github,
  Globe,
  Loader2,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useProjects, fileCount } from "@/lib/appgen/projects";
import { usePublishApp } from "@/hooks/usePublishApp";
import { repoNameFrom } from "@/lib/github";
import { chainConfig } from "@/lib/chains";
import { slugForChainId } from "@/lib/explorer/network";
import { shortAddr, timeAgo } from "@/lib/explorer/format";

// Everything about one app: who built it, what is in it, where it is published,
// and where its source lives.
//
// The list used to open the builder directly, so none of this was visible
// anywhere. Publishing reuses usePublishApp (shared with the builder); the
// GitHub push talks to api.github.com straight from the browser so the user's
// token never reaches our servers.

export const Route = createFileRoute("/launchkit/apps/$id")({
  head: () => ({ meta: [{ title: "App: DevStation" }] }),
  component: AppDetail,
});

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
      <span className="font-mono text-[10px] uppercase tracking-wide text-meta">{label}</span>
      <span className="min-w-0 text-right font-mono text-[11px] text-foreground">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border">
      <p className="border-b border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
        {title}
      </p>
      <div className="px-3 py-2">{children}</div>
    </div>
  );
}

function AppDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { isConnected } = useAccount();

  const projects = useProjects((s) => s.projects);
  const hydrate = useProjects((s) => s.hydrate);
  const open = useProjects((s) => s.open);
  const rename = useProjects((s) => s.rename);
  const remove = useProjects((s) => s.remove);
  useEffect(() => hydrate(), [hydrate]);

  const project = projects.find((p) => p.id === id) ?? null;

  const { publish, unpublish, publishing } = usePublishApp();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);

  // GitHub
  const [repoName, setRepoName] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [gh, setGh] = useState<{
    configured: boolean;
    user: { login: string; avatarUrl: string; name: string | null } | null;
  } | null>(null);
  // Who, if anyone, is signed in. The token itself lives in an httpOnly cookie
  // and is deliberately unreadable here.
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
    if (!project) return;
    setRepoName((r) => r || repoNameFrom(project.name));
  }, [project]);

  const totalBytes = useMemo(() => {
    if (!project) return 0;
    return Object.values(project.files ?? {}).reduce((n, c) => n + c.length, 0);
  }, [project]);

  if (!project) {
    return (
      <div>
        <PageHeader breadcrumb={["DevStation", "LaunchKit", "Apps"]} title="App not found" />
        <div className="py-6 px-5 sm:px-8 lg:px-12">
          <p className="font-mono text-xs text-muted-foreground">
            That app is not in this browser.{" "}
            <Link to="/launchkit/apps" className="text-primary hover:underline">
              Back to My Apps
            </Link>
          </p>
          <p className="mt-1 font-mono text-[10px] text-meta">
            Apps are stored locally, so one built in another browser will not appear here.
          </p>
        </div>
      </div>
    );
  }

  const doPush = async () => {
    setPushing(true);
    try {
      const res = await fetch("/api/github/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repoName: repoNameFrom(repoName || project.name),
          isPrivate,
          // Source, deliberately, not `dist`. A repository holds what a person
          // edits; the built output belongs to the publish flow.
          files: project.files,
          message: `Update ${project.name} from DevStation`,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        repo?: { owner: string; name: string; url: string; pushedAt: number };
        message?: string;
      } | null;
      if (!body?.ok || !body.repo) {
        toast.error(body?.message ?? "Push failed.");
        return;
      }
      useProjects.getState().update(project.id, { repo: body.repo });
      toast.success(`Pushed to ${body.repo.owner}/${body.repo.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Push failed.");
    } finally {
      setPushing(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Apps", project.name]}
        title={project.name}
        subtitle={`${fileCount(project)} files · updated ${timeAgo(new Date(project.updatedAt).toISOString())}`}
        action={
          <button
            onClick={() => {
              open(project.id);
              void navigate({ to: "/launchkit/app-builder" });
            }}
            className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Code2 className="h-3 w-3" /> Open in builder
          </button>
        }
      />

      <div className="grid gap-4 py-4 sm:py-6 lg:grid-cols-2 px-5 sm:px-8 lg:px-12">
        <Section title="Overview">
          <Row label="Name">
            {editing ? (
              <span className="flex items-center gap-1">
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      rename(project.id, draft);
                      setEditing(false);
                    }
                    if (e.key === "Escape") setEditing(false);
                  }}
                  className="rounded border border-primary bg-background px-2 py-0.5 font-mono text-[11px] text-foreground focus:outline-none"
                />
                <button
                  onClick={() => {
                    rename(project.id, draft);
                    setEditing(false);
                  }}
                  className="text-meta hover:text-success"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="text-meta hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ) : (
              <span className="flex items-center justify-end gap-1.5">
                {project.name}
                <button
                  onClick={() => {
                    setDraft(project.name);
                    setEditing(true);
                  }}
                  title="Rename"
                  className="text-meta hover:text-foreground"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </span>
            )}
          </Row>
          <Row label="Created">{timeAgo(new Date(project.createdAt).toISOString())}</Row>
          <Row label="Updated">{timeAgo(new Date(project.updatedAt).toISOString())}</Row>
          <Row label="Conversation">{project.history.length} messages</Row>
        </Section>

        <Section title="Built by">
          {project.owner ? (
            <Row label="Wallet">
              <Link
                to="/dev/$address"
                params={{ address: project.owner }}
                className="text-primary hover:underline"
              >
                {shortAddr(project.owner)}
              </Link>
            </Row>
          ) : (
            <p className="py-1 font-mono text-[11px] text-meta">
              Not recorded: this app predates authorship tracking.
            </p>
          )}
          {project.attached ? (
            <Row label="Contract">
              <Link
                to="/explorer/$network/address/$hash"
                params={{
                  network: slugForChainId(project.attached.chainId),
                  hash: project.attached.address,
                }}
                className="text-primary hover:underline"
              >
                {shortAddr(project.attached.address)}
              </Link>
              <span className="ml-1 text-meta">{`on ${chainConfig(project.attached.chainId).name}`}</span>
            </Row>
          ) : (
            <Row label="Contract">
              <span className="text-meta">none attached</span>
            </Row>
          )}
        </Section>

        <Section title="Contents">
          <Row label="Files">{fileCount(project)}</Row>
          <Row label="Source size">
            {totalBytes < 1024 ? `${totalBytes} B` : `${(totalBytes / 1024).toFixed(1)} KB`}
          </Row>
          <Row label="Build output">
            {project.dist && Object.keys(project.dist).length ? (
              `${Object.keys(project.dist).length} files`
            ) : (
              <span className="text-meta">not built yet</span>
            )}
          </Row>
          <div className="mt-2 max-h-40 overflow-auto rounded border border-border bg-surface-2 p-2">
            {Object.keys(project.files ?? {}).length === 0 ? (
              <p className="font-mono text-[10px] text-meta">No files yet.</p>
            ) : (
              Object.keys(project.files)
                .sort()
                .map((f) => (
                  <p key={f} className="truncate font-mono text-[10px] text-muted-foreground">
                    <FileCode2 className="mr-1 inline h-2.5 w-2.5" />
                    {f.replace(/^app\//, "")}
                  </p>
                ))
            )}
          </div>
        </Section>

        <Section title="Live">
          {project.liveUrl ? (
            <>
              <Row label="URL">
                <a
                  href={project.liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  {project.liveUrl.replace(/^https?:\/\//, "")}{" "}
                  <ExternalLink className="inline h-2.5 w-2.5" />
                </a>
              </Row>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => void publish(project)}
                  disabled={publishing}
                  className="flex-1 rounded border border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {publishing ? "Publishing…" : "Republish"}
                </button>
                <button
                  onClick={() => void unpublish(project)}
                  className="rounded border border-border px-2 py-1.5 font-mono text-[11px] text-meta hover:border-danger hover:text-danger"
                >
                  Unpublish
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="py-1 font-mono text-[11px] text-meta">
                Not published. Publishing puts the built app on its own subdomain.
              </p>
              <button
                onClick={() => void publish(project)}
                disabled={publishing || !isConnected}
                title={
                  isConnected
                    ? undefined
                    : "Connect a wallet: publishing is rate limited per wallet"
                }
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {publishing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Globe className="h-3 w-3" />
                )}
                {isConnected ? "Publish" : "Connect a wallet to publish"}
              </button>
            </>
          )}
        </Section>

        <Section title="GitHub">
          {gh === null ? (
            <p className="py-1 font-mono text-[11px] text-meta">Checking GitHub…</p>
          ) : !gh.configured ? (
            <p className="py-1 font-mono text-[11px] text-meta">
              GitHub sign-in is not configured on this deployment. Set GITHUB_CLIENT_ID and
              GITHUB_CLIENT_SECRET to enable it.
            </p>
          ) : !gh.user ? (
            <>
              <p className="py-1 font-mono text-[11px] text-meta">
                Connect your GitHub account once, then push this app to a repository.
              </p>
              <a
                href="/api/github?start=1"
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Github className="h-3 w-3" /> Connect GitHub
              </a>
            </>
          ) : (
            <>
              <Row label="Signed in as">
                <span className="flex items-center justify-end gap-1.5">
                  <img src={gh.user.avatarUrl} alt="" className="h-4 w-4 rounded-full" />
                  {gh.user.login}
                </span>
              </Row>
              {project.repo && (
                <Row label="Repository">
                  <a
                    href={project.repo.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {project.repo.owner}/{project.repo.name}{" "}
                    <ExternalLink className="inline h-2.5 w-2.5" />
                  </a>
                </Row>
              )}
              {project.repo && (
                <Row label="Last push">
                  {timeAgo(new Date(project.repo.pushedAt).toISOString())}
                </Row>
              )}

              {/* Only shown before the first push: once a repo exists the name
                  and visibility are settled, and re-asking invites pushing an
                  app into the wrong place. */}
              {!project.repo && (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={repoName}
                    onChange={(e) => setRepoName(e.target.value)}
                    placeholder="repo-name"
                    className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
                  />
                  <label className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={isPrivate}
                      onChange={(e) => setIsPrivate(e.target.checked)}
                    />
                    Private
                  </label>
                </div>
              )}

              <button
                onClick={() => void doPush()}
                disabled={pushing}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {pushing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Github className="h-3 w-3" />
                )}
                {project.repo ? "Push update" : "Create repo and push"}
              </button>

              <button
                onClick={() => {
                  void fetch("/api/github", { method: "POST" }).then(() =>
                    setGh({ configured: true, user: null }),
                  );
                }}
                className="mt-1 w-full font-mono text-[10px] text-meta hover:text-foreground"
              >
                Disconnect
              </button>
            </>
          )}
        </Section>

        <Section title="Danger">
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-danger">Delete this app?</span>
              <button
                onClick={() => {
                  remove(project.id);
                  void navigate({ to: "/launchkit/apps" });
                }}
                className="rounded border border-danger px-2 py-1 font-mono text-[10px] text-danger hover:bg-danger/10"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirming(false)}
                className="font-mono text-[10px] text-meta hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirming(true)}
              className="flex items-center gap-1.5 font-mono text-[11px] text-meta hover:text-danger"
            >
              <Trash2 className="h-3 w-3" /> Delete this app
            </button>
          )}
        </Section>
      </div>
    </div>
  );
}
