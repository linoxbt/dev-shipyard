import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, LoaderCircle, Star } from "lucide-react";
import { toast } from "sonner";
import { PageShell, useBackHref } from "@/components/coding-agent/PageShell";
import { AuthSheet } from "@/components/coding-agent/AuthSheet";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/lib/appgen/projects";
import { cn } from "@/lib/utils";

// Feedback, asked once someone has built or published an app with
// DevStation (FeedbackPrompt): a rating, what they built, what worked, what
// to improve, and whether they would recommend it. The admins read it on
// /admin/feedback.

export const Route = createFileRoute("/feedback")({
  head: () => ({
    meta: [{ title: "Feedback · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: FeedbackPage,
});

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

function FeedbackPage() {
  const ready = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  const projects = useProjects((s) => s.projects);
  const back = useBackHref();
  const [signIn, setSignIn] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [recommend, setRecommend] = useState<number | null>(null);
  const [built, setBuilt] = useState("");
  const [worked, setWorked] = useState("");
  const [improve, setImprove] = useState("");
  const [context, setContext] = useState<{ project: string | null; siteUrl: string | null }>({
    project: null,
    siteUrl: null,
  });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    useAuth.getState().init();
    void useProjects.getState().hydrate();
  }, []);

  // The app it is about: the one it was opened from, else the latest built.
  useEffect(() => {
    if (context.project || !projects.length) return;
    const id = new URLSearchParams(window.location.search).get("project");
    const p =
      projects.find((x) => x.id === id) ??
      [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (!p) return;
    setContext({ project: p.name, siteUrl: p.liveUrl ?? null });
    setBuilt((b) => b || p.name);
  }, [projects, context.project]);

  const send = async () => {
    if (!rating) return void toast.error("Choose a rating first.");
    setSending(true);
    const res = await fetchWithGrant("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rating,
        recommend,
        built,
        worked,
        improve,
        project: context.project,
        siteUrl: context.siteUrl?.startsWith("https://") ? context.siteUrl : null,
      }),
    }).catch(() => null);
    setSending(false);
    const body = (await res?.json().catch(() => ({}))) as { message?: string } | undefined;
    if (!res?.ok) return void toast.error(body?.message || "That did not send. Try again.");
    setSent(true);
  };

  return (
    <PageShell
      title="Tell us how it went"
      description="Two minutes of your thoughts shape what DevStation does next. Everything here goes to the DevStation team only."
    >
      {!ready ? (
        <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading
        </p>
      ) : !signedIn ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-[14.5px]">Sign in with your email to send feedback.</p>
          <button
            onClick={() => setSignIn(true)}
            className="mt-4 rounded-full bg-primary px-5 py-2 text-[14px] font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Sign in
          </button>
          {signIn && <AuthSheet onClose={() => setSignIn(false)} />}
        </div>
      ) : sent ? (
        <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/10 text-success">
            <Check className="h-6 w-6" />
          </span>
          <p className="mt-4 text-[18.5px] font-semibold">Thank you</p>
          <p className="mx-auto mt-1 max-w-sm text-[14px] leading-6 text-muted-foreground">
            Your feedback reached the team. It is read by people, and it changes what we build.
          </p>
          <a
            href={back}
            className="mt-6 inline-flex rounded-full bg-primary px-5 py-2 text-[14px] font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Back to DevStation
          </a>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="space-y-5"
        >
          <Section title="How was building with DevStation?" required>
            <div className="flex items-center gap-1" onMouseLeave={() => setHover(0)}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHover(n)}
                  aria-label={`${n} of 5: ${RATING_WORDS[n]}`}
                  aria-pressed={rating === n}
                  className="rounded-lg p-1 transition hover:scale-110"
                >
                  <Star
                    className={cn(
                      "h-8 w-8",
                      (hover || rating) >= n
                        ? "fill-primary text-primary"
                        : "text-muted-foreground/40",
                    )}
                  />
                </button>
              ))}
              <span className="ml-2 text-[14px] text-muted-foreground">
                {RATING_WORDS[hover || rating]}
              </span>
            </div>
          </Section>

          <Section title="What did you build?">
            <Field
              value={built}
              onChange={setBuilt}
              rows={2}
              max={2000}
              placeholder="A habit tracker for my team, a landing page for my bakery…"
            />
            {context.siteUrl && (
              <p className="mt-2 text-[12.5px] text-meta">
                Published at{" "}
                <a href={context.siteUrl} target="_blank" rel="noreferrer" className="underline">
                  {context.siteUrl.replace(/^https:\/\//, "")}
                </a>
              </p>
            )}
          </Section>

          <Section title="What worked well?">
            <Field
              value={worked}
              onChange={setWorked}
              rows={3}
              max={4000}
              placeholder="What surprised you, saved you time, or felt right."
            />
          </Section>

          <Section title="What should we improve?">
            <Field
              value={improve}
              onChange={setImprove}
              rows={4}
              max={4000}
              placeholder="Anything that was slow, confusing, broken or missing."
            />
          </Section>

          <Section title="How likely are you to recommend DevStation to a friend?">
            <div className="grid grid-cols-11 gap-1">
              {Array.from({ length: 11 }, (_, n) => (
                <button
                  type="button"
                  key={n}
                  onClick={() => setRecommend(n)}
                  aria-pressed={recommend === n}
                  className={cn(
                    "h-9 rounded-lg border text-[13.5px] tabular-nums transition",
                    recommend === n
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex justify-between text-[12px] text-meta">
              <span>Not likely</span>
              <span>Very likely</span>
            </div>
          </Section>

          <div className="flex items-center justify-end gap-3 pt-1">
            <a href={back} className="text-[14px] text-muted-foreground hover:text-foreground">
              Not now
            </a>
            <button
              type="submit"
              disabled={sending || !rating}
              className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
            >
              {sending && <LoaderCircle className="h-4 w-4 animate-spin" />} Send feedback
            </button>
          </div>
        </form>
      )}
    </PageShell>
  );
}

function Section({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <p className="mb-3 text-[15px] font-medium">
        {title}
        {required && <span className="ml-1 text-primary">*</span>}
      </p>
      {children}
    </section>
  );
}

function Field({
  value,
  onChange,
  rows,
  max,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  rows: number;
  max: number;
  placeholder: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, max))}
      rows={rows}
      placeholder={placeholder}
      className="w-full resize-y rounded-xl border border-border bg-background px-3.5 py-2.5 text-[14.5px] leading-6 outline-none focus:border-primary"
    />
  );
}
