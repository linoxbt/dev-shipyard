import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  ExportMenu,
  Overview,
  ProTable,
  RangePicker,
  Shell,
  Skeleton,
  Unavailable,
  type Payload,
  type Range,
} from "@/components/stats/StatsDashboard";
import { ShareLinks } from "@/components/stats/ShareLinks";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// DevStation's own figures, for the accounts in ADMIN_EMAILS: how many people
// sign up and build, how the agent does, what the models cost, and who asked
// for Pro. One call to api/admin/stats (devstation_dashboard in the database)
// for the chosen period, each figure beside the same period before it. The
// admins can also share a read-only copy by link (ShareLinks).

export const Route = createFileRoute("/admin/stats")({
  head: () => ({
    meta: [{ title: "Analytics · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: StatsPage,
});

function StatsPage() {
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => useAuth.getState().init(), []);

  const load = useCallback(async (days: Range) => {
    setLoading(true);
    try {
      const res = await fetchWithGrant(`/api/admin/stats?days=${days}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "The figures could not be read.");
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
      setError("Sign in with an admin email to see this page.");
      return;
    }
    void load(range);
  }, [authReady, signedIn, range, load]);

  const setPlan = async (owner: string, plan: "pro" | "free") => {
    const res = await fetchWithGrant("/api/admin/stats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "set_plan", owner, plan }),
    });
    if (!res.ok) return void toast.error("That plan could not be changed.");
    toast.success(plan === "pro" ? "Moved to Pro." : "Moved back to free.");
    void load(range);
  };

  const d = data?.dashboard;

  return (
    <Shell
      label="Analytics"
      controls={
        // Nothing to refresh or export until there are figures to show.
        data ? (
          <>
            <RangePicker value={range} onChange={setRange} />
            <button
              onClick={() => void load(range)}
              disabled={loading}
              aria-label="Refresh"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
            <ExportMenu hrefFor={(file) => `/api/admin/stats?download=${file}`} />
          </>
        ) : undefined
      }
    >
      {error ? (
        <Unavailable title="The figures are not available" message={error} signIn />
      ) : !d ? (
        <Skeleton />
      ) : (
        <Overview
          d={d}
          loading={loading}
          pending={data!.proRequests.filter((r) => r.plan !== "pro").length}
        >
          <Card title="Pro access" note="Requests waiting, and accounts on Pro">
            <ProTable rows={data!.proRequests} onSet={setPlan} />
          </Card>
          <Card
            title="Share these figures"
            note="A link anyone can open to view and export them, nothing else. Revoke it whenever you like."
          >
            <ShareLinks />
          </Card>
        </Overview>
      )}
    </Shell>
  );
}
