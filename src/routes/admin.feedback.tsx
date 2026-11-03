import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, RefreshCw, Star } from "lucide-react";
import { Card, Shell, Unavailable, when } from "@/components/stats/StatsDashboard";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// What people told DevStation through the feedback form (routes/feedback.tsx),
// for the accounts in ADMIN_EMAILS: the averages, how the ratings spread, and
// every response, newest first, with a CSV download.

export const Route = createFileRoute("/admin/feedback")({
  head: () => ({
    meta: [{ title: "Feedback · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: FeedbackAdmin,
});

interface Response {
  id: string;
  email: string | null;
  rating: number;
  recommend: number | null;
  built: string;
  worked: string;
  improve: string;
  project: string | null;
  siteUrl: string | null;
  createdAt: string;
}

interface Payload {
  summary: {
    responses: number;
    people: number;
    averageRating: number | null;
    nps: number | null;
    byRating: number[];
  };
  feedback: Response[];
}

function FeedbackAdmin() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [only, setOnly] = useState<number | null>(null);

  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => useAuth.getState().init(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWithGrant("/api/admin/feedback");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Feedback could not be read.");
      setData(body as Payload);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!signedIn) {
      setError("Sign in on DevStation with an admin email, then open this page again.");
      return;
    }
    void load();
  }, [authReady, signedIn, load]);

  const shown = useMemo(
    () => (data?.feedback ?? []).filter((f) => only === null || f.rating === only),
    [data, only],
  );
  const s = data?.summary;
  const most = s ? Math.max(1, ...s.byRating) : 1;

  return (
    <Shell
      label="Feedback"
      controls={
        <>
          <button
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <a
            href="/api/admin/feedback?download=csv"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </a>
        </>
      }
    >
      {error && !data ? (
        <Unavailable title="Feedback is not available" message={error} />
      ) : !data || !s ? (
        <div className="space-y-4">
          <div className="ds-skeleton h-32 rounded-2xl" />
          <div className="ds-skeleton h-72 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-[22.5px] font-semibold tracking-tight">Feedback</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
              What people say after building or publishing an app. They are asked once, on the home
              screen and after publishing.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Figure label="Responses" value={s.responses.toLocaleString()}>
              from {s.people.toLocaleString()} {s.people === 1 ? "person" : "people"}
            </Figure>
            <Figure
              label="Average rating"
              value={s.averageRating === null ? "–" : `${s.averageRating.toFixed(1)} / 5`}
            >
              <Stars n={Math.round(s.averageRating ?? 0)} />
            </Figure>
            <Figure label="Net promoter score" value={s.nps === null ? "–" : String(s.nps)}>
              from -100 to 100
            </Figure>
            <div className="rounded-2xl border border-border bg-surface px-4 py-3">
              <p className="text-[12.5px] text-muted-foreground">How the ratings spread</p>
              <div className="mt-2 space-y-1">
                {[5, 4, 3, 2, 1].map((n) => (
                  <button
                    key={n}
                    onClick={() => setOnly(only === n ? null : n)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded text-[12px] tabular-nums",
                      only === n
                        ? "text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    aria-pressed={only === n}
                    title={`Show only ${n}-star responses`}
                  >
                    <span className="w-3">{n}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(s.byRating[n - 1] / most) * 100}%` }}
                      />
                    </span>
                    <span className="w-6 text-right">{s.byRating[n - 1]}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Card
            title={only ? `${only}-star responses` : "Every response"}
            note={
              only ? (
                <button onClick={() => setOnly(null)} className="text-primary hover:underline">
                  Show all
                </button>
              ) : (
                "Newest first"
              )
            }
          >
            {shown.length === 0 ? (
              <p className="py-10 text-center text-[13.5px] text-muted-foreground">
                {data.feedback.length ? "None with that rating." : "No feedback yet."}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {shown.map((f) => (
                  <li key={f.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Stars n={f.rating} />
                      <span className="text-[13.5px] font-medium">{f.email ?? "Unknown"}</span>
                      {f.recommend !== null && (
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[11.5px] font-medium",
                            f.recommend >= 9
                              ? "bg-success/10 text-success"
                              : f.recommend <= 6
                                ? "bg-danger/10 text-danger"
                                : "bg-surface-2 text-muted-foreground",
                          )}
                        >
                          Would recommend {f.recommend}/10
                        </span>
                      )}
                      <span className="ml-auto text-[12.5px] text-meta">{when(f.createdAt)}</span>
                    </div>
                    {(f.built || f.project) && (
                      <p className="mt-2 text-[13.5px] text-muted-foreground">
                        Built: <span className="text-foreground">{f.built || f.project}</span>
                        {f.siteUrl && (
                          <a
                            href={f.siteUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="ml-2 inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            Open <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </p>
                    )}
                    <div className="mt-2 grid gap-3 md:grid-cols-2">
                      <Answer label="What worked" text={f.worked} />
                      <Answer label="What to improve" text={f.improve} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </Shell>
  );
}

function Figure({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[24.5px] font-semibold tabular-nums">{value}</p>
      <div className="mt-1 text-[12px] text-meta">{children}</div>
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex" aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i <= n ? "fill-primary text-primary" : "text-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );
}

function Answer({ label, text }: { label: string; text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-xl bg-surface-2/50 px-3.5 py-2.5">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-meta">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-[14px] leading-6">{text}</p>
    </div>
  );
}
