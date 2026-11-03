import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, MessageSquareHeart, Star, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import type { AppProject } from "@/lib/appgen/projects";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { cn } from "@/lib/utils";

// Feedback, asked in a pop-up on the project screen while someone builds:
// once they have built an app (the agent changed its files) or published one.
// It floats in a corner and never blocks the work, so they can answer while
// the agent carries on. A rating first; picking one opens the rest. Asked
// until answered; "Not now" puts it away for three days, on this device.
// The same answers can be given on /feedback (linked after publishing).

const SNOOZE_MS = 3 * 24 * 60 * 60_000;
/** How long someone has been building, in this visit, before it is asked. */
const SETTLE_MS = 20_000;
const snoozeKey = (email: string) => `devstation:feedback-snoozed:${email}`;

/** The project worth asking about: the latest one built by the agent, or
 *  published (a published one first). */
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

function snooze(email: string) {
  try {
    localStorage.setItem(snoozeKey(email), String(Date.now()));
  } catch {
    /* best effort */
  }
}

/** Whether each account still owes feedback, asked of the server once per
 *  visit and account. A failed answer is not kept: the next look asks again. */
const owed = new Map<string, Promise<boolean | null>>();
function stillOwed(email: string): Promise<boolean | null> {
  let p = owed.get(email);
  if (!p) {
    p = fetchWithGrant("/api/feedback")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { submitted?: number } | null) => (d ? !d.submitted : null))
      .catch(() => null);
    owed.set(email, p);
    void p.then((v) => {
      if (v === null) owed.delete(email);
    });
  }
  return p;
}

export interface FeedbackAnswers {
  rating: number;
  recommend: number | null;
  built: string;
  worked: string;
  improve: string;
  project: string | null;
  siteUrl: string | null;
}

/** Send feedback; null when it was saved, else what went wrong. */
export async function sendFeedback(a: FeedbackAnswers): Promise<string | null> {
  const res = await fetchWithGrant("/api/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...a, siteUrl: a.siteUrl?.startsWith("https://") ? a.siteUrl : null }),
  }).catch(() => null);
  if (res?.ok) {
    const email = useAuth.getState().account?.email;
    if (email) owed.set(email, Promise.resolve(false));
    return null;
  }
  const body = (await res?.json().catch(() => ({}))) as { message?: string } | undefined;
  return body?.message || "That did not send. Try again.";
}

const WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/**
 * The pop-up, on the project screen. `projects` decides whether anything has
 * been built yet; `current` is the project open, which the answers are about
 * when it counts.
 */
export function FeedbackPopup({
  projects,
  current,
  mobile,
}: {
  projects: readonly AppProject[];
  current: AppProject | null;
  mobile?: boolean;
}) {
  const email = useAuth((s) => s.account?.email ?? null);
  const subject = (current && builtSomething([current])) ?? builtSomething(projects) ?? null;
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [worked, setWorked] = useState("");
  const [improve, setImprove] = useState("");
  const [recommend, setRecommend] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  /** The account already asked in this visit (another account signing in
   *  here is asked for itself). */
  const asked = useRef<string | null>(null);

  // Once something is built, and they have been at it a little while.
  useEffect(() => {
    if (!email || !subject || asked.current === email || snoozed(email)) return;
    let live = true;
    const t = setTimeout(() => {
      void stillOwed(email).then((due) => {
        if (!live || !due || asked.current === email) return;
        asked.current = email;
        setOpen(true);
      });
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // Once per account and project worth asking about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, subject?.id]);

  if (!open || !email || !subject) return null;

  const later = () => {
    snooze(email);
    setOpen(false);
  };

  const send = async () => {
    if (!rating) return;
    setSending(true);
    const problem = await sendFeedback({
      rating,
      recommend,
      built: subject.name,
      worked,
      improve,
      project: subject.name,
      siteUrl: subject.liveUrl ?? null,
    });
    setSending(false);
    if (problem) return void toast.error(problem);
    setSent(true);
    setTimeout(() => setOpen(false), 2600);
  };

  return (
    <div
      role="dialog"
      aria-label="Feedback"
      className={cn(
        "fixed z-50 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl shadow-black/20 [animation:ds-sheet-up_0.35s_ease-out_both]",
        mobile
          ? "inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5rem)] max-h-[70dvh] overflow-y-auto"
          : "bottom-6 right-6 w-[380px]",
      )}
    >
      {sent ? (
        <div className="flex items-center gap-3 px-5 py-5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success/10 text-success">
            <Check className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[15px] font-semibold">Thank you</p>
            <p className="text-[13.5px] text-muted-foreground">
              Your feedback reached the DevStation team.
            </p>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="px-4 pb-4 pt-3.5"
        >
          <div className="flex items-start gap-2.5">
            <MessageSquareHeart className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-semibold leading-snug">
                How is building {subject.name} going?
              </p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                A few seconds of feedback helps us make DevStation better. Keep building, the agent
                carries on.
              </p>
            </div>
            <button
              type="button"
              onClick={later}
              aria-label="Not now"
              className="-mr-1 -mt-0.5 rounded-full p-1 text-meta hover:bg-surface-2 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                type="button"
                key={n}
                onClick={() => setRating(n)}
                onMouseEnter={() => setHover(n)}
                aria-label={`${n} of 5: ${WORDS[n]}`}
                aria-pressed={rating === n}
                className="rounded-md p-1 transition hover:scale-110"
              >
                <Star
                  className={cn(
                    "h-7 w-7",
                    (hover || rating) >= n
                      ? "fill-primary text-primary"
                      : "text-muted-foreground/35",
                  )}
                />
              </button>
            ))}
            <span className="ml-2 text-[13.5px] text-muted-foreground">
              {WORDS[hover || rating]}
            </span>
          </div>

          {rating > 0 && (
            <div className="mt-3 space-y-3 [animation:fade-up_0.3s_ease-out_both]">
              <textarea
                value={worked}
                onChange={(e) => setWorked(e.target.value.slice(0, 4000))}
                rows={2}
                placeholder="What worked well?"
                className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-[14px] leading-6 outline-none focus:border-primary"
              />
              <textarea
                value={improve}
                onChange={(e) => setImprove(e.target.value.slice(0, 4000))}
                rows={2}
                placeholder="What should we improve?"
                className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-[14px] leading-6 outline-none focus:border-primary"
              />
              <div>
                <p className="text-[13px] text-muted-foreground">
                  How likely are you to recommend DevStation?
                </p>
                <div className="mt-1.5 grid grid-cols-11 gap-0.5">
                  {Array.from({ length: 11 }, (_, n) => (
                    <button
                      type="button"
                      key={n}
                      onClick={() => setRecommend(n)}
                      aria-pressed={recommend === n}
                      className={cn(
                        "h-7 rounded-md border text-[12px] tabular-nums transition",
                        recommend === n
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={later}
                  className="text-[13.5px] text-muted-foreground hover:text-foreground"
                >
                  Not now
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[13.5px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
                >
                  {sending && <LoaderCircle className="h-4 w-4 animate-spin" />} Send
                </button>
              </div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
