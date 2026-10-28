import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Copy,
  ExternalLink,
  Github,
  GitPullRequest,
  LoaderCircle,
  Users,
} from "lucide-react";
import { BuilderName } from "@/components/builder/BuilderName";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { postWorkspace, slugOf } from "@/lib/coding-agent/workspace-client";
import { useProjects, type AppProject } from "@/lib/appgen/projects";
import { Field, Modal, inputClass, primaryButton } from "./primitives";

// Sharing a workspace with other builders, pushing to GitHub and opening a
// pull request. The requests are unchanged from the old panels; only where
// they sit is new.

/** Who builds on this app: the owner adds wallets and shares the invite link;
 *  a builder sees who is in. */
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
  const [wallet, setWallet] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const change = async (target: string, remove: boolean) => {
    if (!id) return;
    setBusy(true);
    const result = await postWorkspace({ action: "members", id, wallet: target, remove });
    setBusy(false);
    if (!result.ok) {
      toast.error(String(result.data.message ?? "That did not work."));
      return;
    }
    const collaborators = (result.data.collaborators as string[]) ?? [];
    setMembers((m) => (m ? { ...m, collaborators } : m));
    useProjects.getState().update(project.id, { shared: collaborators.length > 0 });
    if (!remove) {
      setWallet("");
      toast.success("Added. Send them the invite link.");
    }
  };

  const link = id
    ? `${window.location.origin}/launchkit/coding-agent?join=${encodeURIComponent(id)}&name=${encodeURIComponent(project.name)}`
    : "";
  const isOwner = members?.role === "owner";
  const valid = /^0x[a-fA-F0-9]{40}$/.test(wallet.trim());

  return (
    <Modal title={`Share ${project.name}`} icon={Users} onClose={onClose}>
      {failed ? (
        <p className="text-[13px] text-warning">{failed}</p>
      ) : !members ? (
        <p className="flex items-center gap-2 text-[13px] text-meta">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Reading the workspace…
        </p>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] leading-5 text-muted-foreground">
            Builders open the invite link with the wallet you add. They talk to the same agent and
            see the same files and preview. The agent takes one message at a time.
          </p>
          {isOwner ? (
            <div className="flex items-center gap-2">
              <input
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="0x… wallet to add"
                className={`${inputClass} font-mono`}
              />
              <button
                onClick={() => void change(wallet.trim(), false)}
                disabled={busy || !valid}
                className={primaryButton}
              >
                Add
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-meta">Only the owner adds builders.</p>
          )}
          <ul className="divide-y divide-border rounded-lg border border-border">
            <li className="flex items-center gap-2 px-3 py-2 font-mono text-[12px]">
              <BuilderName address={members.owner} link={false} />
              <span className="ml-auto text-[11px] text-meta">Owner</span>
            </li>
            {members.collaborators.map((c) => (
              <li key={c} className="flex items-center gap-2 px-3 py-2 font-mono text-[12px]">
                <BuilderName address={c} link={false} />
                <span className="ml-auto text-[11px] text-meta">Builder</span>
                {isOwner && (
                  <button
                    onClick={() => void change(c, true)}
                    disabled={busy}
                    className="text-[11px] text-meta hover:text-danger disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
          <Field label="Invite link">
            <div className="flex items-center gap-2">
              <input readOnly value={link} className={`${inputClass} font-mono text-[11px]`} />
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground hover:border-primary hover:text-primary"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </Field>
        </div>
      )}
    </Modal>
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
