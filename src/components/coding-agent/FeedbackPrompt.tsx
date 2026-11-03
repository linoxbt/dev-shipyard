import { useEffect, useState } from "react";
import { MessageSquareHeart, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import type { AppProject } from "@/lib/appgen/projects";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { pageHref } from "./PageShell";

// Asking for feedback at the right moment: once someone has built an app
// (the agent changed its files) or published one, and only until they answer.
// "Not now" puts it away for two weeks, on this device.

const SNOOZE_MS = 14 * 24 * 60 * 60_000;
const snoozeKey = (email: string) => `devstation:feedback-snoozed:${email}`;

/** Whether a project counts: built by the agent, or published. */
export function builtSomething(projects: readonly AppProject[]): AppProject | null {
  const done = projects
    .filter(
      (p) =>
        !!p.liveUrl ||
        p.turns.some((t) => t.role === "assistant" && !t.failed && (t.changed?.length ?? 0) > 0),
    )
    .sort((a, b) => Number(!!b.liveUrl) - Number(!!a.liveUrl) || b.updatedAt - a.updatedAt);
  return done[0] ?? null;
}

function snoozed(email: string): boolean {
  try {
    return Date.now() - Number(localStorage.getItem(snoozeKey(email)) ?? 0) < SNOOZE_MS;
  } catch {
    return false;
  }
}

export function FeedbackPrompt({ projects }: { projects: readonly AppProject[] }) {
  const email = useAuth((s) => s.account?.email ?? null);
  const project = builtSomething(projects);
  const [due, setDue] = useState(false);

  useEffect(() => {
    if (!email || !project || snoozed(email)) return setDue(false);
    let live = true;
    void fetchWithGrant("/api/feedback")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { submitted?: number } | null) => live && setDue(!!d && !d.submitted))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Asked once per account and project found, not on every project change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, project?.id]);

  if (!due || !project || !email) return null;
  const later = () => {
    try {
      localStorage.setItem(snoozeKey(email), String(Date.now()));
    } catch {
      /* best effort */
    }
    setDue(false);
  };
  return (
    <div className="mb-6 flex items-start gap-3 rounded-2xl border border-primary/25 bg-primary/5 px-4 py-3.5">
      <MessageSquareHeart className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] font-medium text-foreground">
          {project.liveUrl ? `You published ${project.name}.` : `You built ${project.name}.`} How
          did it go?
        </p>
        <p className="mt-0.5 text-[13.5px] leading-5 text-muted-foreground">
          Two minutes of feedback helps us make DevStation better for you.
        </p>
        <div className="mt-2.5 flex items-center gap-3">
          <a
            href={pageHref(`/feedback?project=${encodeURIComponent(project.id)}`)}
            className="rounded-full bg-primary px-4 py-1.5 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Give feedback
          </a>
          <button
            onClick={later}
            className="text-[13.5px] text-muted-foreground hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
      <button
        onClick={later}
        aria-label="Dismiss"
        className="rounded-full p-1 text-meta hover:bg-surface-2 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
