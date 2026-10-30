import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ExternalLink,
  Github,
  GitPullRequest,
  LoaderCircle,
  UserPlus,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { accountAddressOf } from "@/lib/auth/account";
import { cn } from "@/lib/utils";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { postWorkspace, slugOf } from "@/lib/coding-agent/workspace-client";
import { AGENT_PATH } from "@/lib/features";
import { useProjects, type AppProject } from "@/lib/appgen/projects";
import { Field, Modal, inputClass, primaryButton } from "./primitives";

// Sharing a workspace with other builders, pushing to GitHub and opening a
// pull request. The requests are unchanged from the old panels; only where
// they sit is new.

/** Who builds on this app: the owner adds people by the email they sign in
 *  with and shares the invite link; a builder sees who is in. */
export function BuildersDialog({
  project,
  ensureWorkspace,
  onClose,
}: {
  project: AppProject;
  ensureWorkspace: () => Promise<string | null>;
  onClose: () => void;
}) {
  const [id, setId] = useState<string | null>(project.workspaceId ?? null);
  const [members, setMembers] = useState<{
    role: "owner" | "builder" | null;
    owner: string;
    collaborators: string[];
  } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const account = useAuth((s) => s.account);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => {
    if (account) void accountAddressOf(account.email).then(setMe);
  }, [account]);
  const known = project.builders ?? {};
  /** A listed id as a person: you, an email added here, or a short id. */
  const who = (id: string) => (id === me ? "You" : (known[id] ?? `Builder ${id.slice(2, 8)}`));

  useEffect(() => {
    let alive = true;
    void (async () => {
      const wsId = await ensureWorkspace();
      if (!alive) return;
      if (!wsId) return setFailed("This app has no workspace to share yet.");
      setId(wsId);
      const res = await fetch(`/api/workspace?id=${encodeURIComponent(wsId)}&members=1`).catch(
        () => null,
      );
      const body = (await res?.json().catch(() => null)) as
        | ({ ok?: boolean; message?: string } & NonNullable<typeof members>)
        | null;
      if (!alive) return;
      if (body?.ok) setMembers(body);
      else setFailed(body?.message ?? "Could not read who builds on this app.");
    })();
    return () => {
      alive = false;
    };
    // Once per opening of the dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = async (target: { email: string } | { wallet: string }, remove: boolean) => {
    if (!id) return;
    setBusy(true);
    const result = await postWorkspace({ action: "members", id, ...target, remove });
    setBusy(false);
    if (!result.ok) {
      toast.error(String(result.data.message ?? "That did not work."));
      return;
    }
    const collaborators = (result.data.collaborators as string[]) ?? [];
    setMembers((m) => (m ? { ...m, collaborators } : m));
    const patch: Partial<AppProject> = { shared: collaborators.length > 0 };
    if ("email" in target && !remove) {
      // Remember who that id is, so the list can say so.
      patch.builders = { ...known, [await accountAddressOf(target.email)]: target.email };
    }
    useProjects.getState().update(project.id, patch);
    if (!remove) {
      setEmail("");
      toast.success("Added. Send them the invite link: they sign in with that email to join.");
    }
  };

  const link = id
    ? `${window.location.origin}${AGENT_PATH}?join=${encodeURIComponent(id)}&name=${encodeURIComponent(project.name)}`
    : "";
  const isOwner = members?.role === "owner";
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const everyone = members ? [members.owner, ...members.collaborators] : [];
  return (
    <Modal
      onClose={onClose}
      hero={
        <div className="relative mx-5 mt-2 flex h-36 items-end justify-center overflow-hidden rounded-3xl bg-[radial-gradient(70%_90%_at_50%_100%,color-mix(in_oklch,var(--primary)_35%,transparent),transparent)] pb-5 sm:mt-5">
          <div className="flex items-end -space-x-3">
            {(everyone.length ? everyone.slice(0, 4) : ["0x1", "0x2", "0x3"]).map((a, i) => (
              <span
                key={a}
                className={cn(
                  "flex items-center justify-center rounded-full bg-surface-2 font-semibold text-foreground/80 ring-4 ring-surface",
                  i === 1 ? "h-[72px] w-[72px] text-[20px]" : "h-14 w-14 text-[16px]",
                )}
              >
                {everyone.length ? who(a).slice(0, 1).toUpperCase() : ""}
              </span>
            ))}
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-2 text-muted-foreground ring-4 ring-surface">
              <UserPlus className="h-6 w-6" />
            </span>
          </div>
        </div>
      }
    >
      <p className="text-[18px] font-semibold text-foreground">Invite builders</p>
      <p className="mt-1 text-[14px] leading-6 text-muted-foreground">
        Add someone by the email they sign in with, then send them the link. They talk to the same
        agent and see the same files and preview of {project.name}. The agent takes one message at a
        time.
      </p>
      {failed ? (
        <p className="mt-4 text-[13.5px] text-warning">{failed}</p>
      ) : !members ? (
        <p className="mt-4 flex items-center gap-2 text-[13.5px] text-meta">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Reading the workspace…
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl bg-background px-4 py-3 text-center font-mono text-[12.5px] text-foreground break-all">
            {link}
          </div>
          <button
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-3 text-[15px] font-medium text-primary-foreground transition hover:bg-primary-hover"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied" : "Copy invite link"}
          </button>

          {isOwner ? (
            <div className="flex items-center gap-2 pt-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Their email"
                className={`${inputClass} rounded-full px-4 py-2`}
              />
              <button
                onClick={() => void change({ email: email.trim().toLowerCase() }, false)}
                disabled={busy || !valid}
                className={`${primaryButton} rounded-full px-4 py-2`}
              >
                Add
              </button>
            </div>
          ) : (
            <p className="pt-1 text-[12.5px] text-meta">Only the owner adds builders.</p>
          )}
          <ul className="divide-y divide-border">
            <li className="flex items-center gap-3 py-2.5 text-[14px]">
              <Avatar label={who(members.owner)} />
              <span className="min-w-0 flex-1 truncate text-foreground">{who(members.owner)}</span>
              <span className="text-[12px] text-meta">Owner</span>
            </li>
            {members.collaborators.map((c) => (
              <li key={c} className="flex items-center gap-3 py-2.5 text-[14px]">
                <Avatar label={who(c)} />
                <span className="min-w-0 flex-1 truncate text-foreground">{who(c)}</span>
                <span className="text-[12px] text-meta">Builder</span>
                {isOwner && (
                  <button
                    onClick={() => void change({ wallet: c }, true)}
                    disabled={busy}
                    className="text-[11.5px] text-meta hover:text-danger disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function Avatar({ label }: { label: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[12.5px] font-semibold text-foreground/80">
      {label.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function GithubDialog({
  kind,
  project,
  workspaceId,
  defaultTitle,
  onClose,
}: {
  kind: "push" | "pr";
  project: AppProject;
  workspaceId: string | null;
  defaultTitle: string;
  onClose: () => void;
}) {
  const [repoName, setRepoName] = useState(slugOf(project.name));
  const [isPrivate, setIsPrivate] = useState(true);
  const [title, setTitle] = useState(defaultTitle);
  const [body, setBody] = useState("");
  const [base, setBase] = useState(project.source?.ref ?? "main");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const push = async () => {
    setBusy(true);
    const res = await fetchWithGrant("/api/github/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repoName, isPrivate, files: project.files }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      repo?: { url: string; owner: string; name: string };
    } | null;
    setBusy(false);
    if (data?.ok && data.repo) {
      useProjects.getState().update(project.id, {
        repo: {
          owner: data.repo.owner,
          name: data.repo.name,
          url: data.repo.url,
          pushedAt: Date.now(),
        },
      });
      setDone(data.repo.url);
      toast.success(`Pushed to ${data.repo.owner}/${data.repo.name}`);
    } else {
      toast.error(data?.message ?? "The push failed.");
    }
  };

  const pull = async () => {
    if (!workspaceId || !project.source?.repo) return;
    setBusy(true);
    const res = await fetch("/api/workspace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "pull_request",
        id: workspaceId,
        repo: project.source.repo,
        base,
        title,
        body,
      }),
    }).catch(() => null);
    const data = (await res?.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      pull?: { url: string; number: number };
    } | null;
    setBusy(false);
    if (data?.ok && data.pull) {
      setDone(data.pull.url);
      toast.success(`Opened pull request #${data.pull.number}`);
    } else {
      toast.error(data?.message ?? "The pull request was not opened.");
    }
  };

  return (
    <Modal
      title={
        kind === "push"
          ? "Push to a new GitHub repository"
          : `Pull request to ${project.source?.repo}`
      }
      icon={kind === "push" ? Github : GitPullRequest}
      onClose={onClose}
    >
      {done ? (
        <a
          href={done}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 break-all font-mono text-[12px] text-primary hover:underline"
        >
          <Check className="h-3.5 w-3.5 shrink-0" /> {done}{" "}
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
        </a>
      ) : kind === "push" ? (
        <div className="space-y-3">
          <Field label="Repository name">
            <input
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </Field>
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
            />
            Private repository
          </label>
          <div className="flex justify-end">
            <button
              onClick={() => void push()}
              disabled={busy || !repoName.trim()}
              className={primaryButton}
            >
              {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Pushing…" : "Push"}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Description">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              placeholder="What changed and why"
              className={inputClass}
            />
          </Field>
          <div className="flex items-end gap-3">
            <Field label="Into branch">
              <input
                value={base}
                onChange={(e) => setBase(e.target.value)}
                className={`${inputClass} w-40 font-mono`}
              />
            </Field>
            <button
              onClick={() => void pull()}
              disabled={busy || !title.trim() || !base.trim()}
              className={`${primaryButton} ml-auto`}
            >
              {busy && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
              {busy ? "Opening…" : "Open pull request"}
            </button>
          </div>
          <p className="text-[12px] text-meta">A new branch against {base}. Nothing is merged.</p>
        </div>
      )}
    </Modal>
  );
}
