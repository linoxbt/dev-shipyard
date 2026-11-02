import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Eye } from "lucide-react";
import {
  ExportMenu,
  Overview,
  RangePicker,
  Shell,
  Skeleton,
  Unavailable,
  type Dashboard,
  type Range,
} from "@/components/stats/StatsDashboard";

// DevStation's figures, opened from a link an admin shared: the same overview
// as the admins see, with every account a pseudonym and the Pro list left out.
// Viewing and exporting only; the admin can revoke the link at any time.

export const Route = createFileRoute("/stats/shared/$token")({
  head: () => ({
    meta: [
      { title: "DevStation figures" },
      { name: "robots", content: "noindex, nofollow" },
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: SharedStats,
});

function SharedStats() {
  const { token } = Route.useParams();
  const [range, setRange] = useState<Range>(30);
  const [data, setData] = useState<{ label: string; dashboard: Dashboard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (days: Range) => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/stats/shared?token=${encodeURIComponent(token)}&days=${days}`,
          { cache: "no-store" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || "The figures could not be read.");
        setData(body);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [token],
  );
  useEffect(() => void load(range), [range, load]);

  const d = data?.dashboard;
  const k = d?.kpis;
  return (
    <Shell
      label="Figures"
      back={false}
      controls={
        d && (
          <>
            <RangePicker value={range} onChange={setRange} />
            <ExportMenu
              hrefFor={(file) =>
                `/api/stats/shared?token=${encodeURIComponent(token)}&download=${file}`
              }
            />
          </>
        )
      }
    >
      {error ? (
        <Unavailable title="This link does not open anything" message={error} />
      ) : !d ? (
        <Skeleton />
      ) : (
        <Overview
          d={d}
          loading={loading}
          pending={Number(k?.pro_requests ?? 0)}
          note={
            <span className="inline-flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              Shared with you{data?.label ? ` (${data.label})` : ""}: view only, accounts
              pseudonymised
            </span>
          }
        />
      )}
    </Shell>
  );
}
