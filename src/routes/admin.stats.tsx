import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { LogoMark } from "@/components/shared/Logo";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";

// DevStation's own figures, for the accounts in ADMIN_EMAILS: totals, daily
// site figures, Pro requests to approve, and downloads of everything to
// publish (src/routes/api.admin.stats.ts).

export const Route = createFileRoute("/admin/stats")({
  head: () => ({ meta: [{ title: "Stats: DevStation" }, { name: "robots", content: "noindex" }] }),
  component: StatsPage,
});

type Summary = Record<string, unknown> & { by_model?: Record<string, number> };
interface Payload {
  summary: Summary;
  daily: { day: string; metric: string; count: number }[];
  proRequests: {
    owner: string;
    plan: string;
    contact: string | null;
    pro_requested_at: string | null;
  }[];
}

const LABELS: [string, string][] = [
  ["accounts", "Accounts"],
  ["accounts_confirmed", "Confirmed accounts"],
  ["builders", "People who built"],
  ["workspaces", "Projects with work"],
  ["turns", "Agent turns"],
  ["turns_finished", "Turns finished"],
  ["steps", "Agent steps"],
  ["cost_usd", "Model cost (USD)"],
  ["premium_cost_usd", "Premium model cost (USD)"],
  ["model_calls", "Model calls"],
  ["credits_claimed", "Launch credits claimed (of 20)"],
  ["pro_accounts", "Pro accounts"],
  ["pro_requests", "Waiting for Pro"],
];

function StatsPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => useAuth.getState().init(), []);

  const load = () =>
    void fetchWithGrant("/api/admin/stats")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || "The figures could not be read.");
        setData(body as Payload);
      })
      .catch((e: Error) => setError(e.message));
  useEffect(() => {
    if (!authReady) return;
    if (!signedIn) {
      setError("Sign in with an admin email on DevStation first, then open this page again.");
      return;
    }
    load();
  }, [authReady, signedIn]);

  const setPlan = async (owner: string, plan: "pro" | "free") => {
    const res = await fetchWithGrant("/api/admin/stats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_plan", owner, plan }),
    });
    if (!res.ok) return toast.error("That plan could not be changed.");
    toast.success(plan === "pro" ? "Moved to Pro." : "Moved back to free.");
    load();
  };

  const totals = new Map<string, number>();
  for (const d of data?.daily ?? [])
    totals.set(d.metric, (totals.get(d.metric) ?? 0) + Number(d.count));

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-8">
        <a href="/" className="flex items-center gap-2 text-[14px] font-semibold text-foreground">
          <LogoMark className="h-7 w-7" /> DevStation stats
        </a>
        <a
          href="/"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to the app
        </a>
      </header>
      <main className="mx-auto max-w-4xl space-y-8 px-4 py-8 sm:px-8">
        {error ? (
          <p className="rounded-2xl bg-surface-2 px-4 py-6 text-center text-[13.5px] text-muted-foreground">
            {error}
          </p>
        ) : !data ? (
          <p className="flex items-center justify-center gap-2 py-10 text-[13px] text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading the figures
          </p>
        ) : (
          <>
            <section className="flex flex-wrap gap-2">
              {[
                ["summary.json", "Everything (JSON)"],
                ["turns.csv", "Every agent turn (CSV)"],
                ["daily.csv", "Daily site figures (CSV)"],
              ].map(([file, label]) => (
                <a
                  key={file}
                  href={`/api/admin/stats?download=${file}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12.5px] text-foreground hover:border-primary/50"
                >
                  <Download className="h-3.5 w-3.5" /> {label}
                </a>
              ))}
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {LABELS.map(([key, label]) => (
                <div key={key} className="rounded-2xl border border-border bg-surface p-4">
                  <p className="text-[11.5px] text-muted-foreground">{label}</p>
                  <p className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
                    {key.endsWith("cost_usd")
                      ? `$${Number(data.summary[key] ?? 0).toFixed(2)}`
                      : Number(data.summary[key] ?? 0).toLocaleString()}
                  </p>
                </div>
              ))}
              {[...totals].map(([metric, count]) => (
                <div key={metric} className="rounded-2xl border border-border bg-surface p-4">
                  <p className="text-[11.5px] text-muted-foreground">
                    {metric.replace(/_/g, " ")} (90 days)
                  </p>
                  <p className="mt-1 text-[22px] font-semibold tabular-nums text-foreground">
                    {count.toLocaleString()}
                  </p>
                </div>
              ))}
            </section>

            {data.summary.by_model && Object.keys(data.summary.by_model).length > 0 && (
              <section>
                <h2 className="text-[15px] font-semibold text-foreground">Turns by model</h2>
                <div className="mt-2 divide-y divide-border rounded-2xl border border-border">
                  {Object.entries(data.summary.by_model).map(([model, n]) => (
                    <p key={model} className="flex justify-between px-4 py-2.5 text-[13px]">
                      <span className="text-foreground">{model}</span>
                      <span className="tabular-nums text-muted-foreground">{n}</span>
                    </p>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-[15px] font-semibold text-foreground">
                Pro requests and Pro accounts
              </h2>
              {data.proRequests.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">None yet.</p>
              ) : (
                <div className="mt-2 divide-y divide-border rounded-2xl border border-border">
                  {data.proRequests.map((r) => (
                    <div key={r.owner} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                        {r.contact ? (
                          <a href={`mailto:${r.contact}`} className="hover:underline">
                            {r.contact}
                          </a>
                        ) : (
                          <span className="font-mono text-[11.5px]">{r.owner}</span>
                        )}
                      </span>
                      {r.pro_requested_at && (
                        <span className="text-[11.5px] text-meta">
                          {new Date(r.pro_requested_at).toLocaleDateString()}
                        </span>
                      )}
                      {r.plan === "pro" ? (
                        <button
                          onClick={() => void setPlan(r.owner, "free")}
                          className="rounded-full border border-border px-3 py-1 text-[12px] text-muted-foreground hover:text-danger"
                        >
                          Pro · revoke
                        </button>
                      ) : (
                        <button
                          onClick={() => void setPlan(r.owner, "pro")}
                          className="rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground hover:bg-primary-hover"
                        >
                          Grant Pro
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
