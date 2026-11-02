import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Download,
  LoaderCircle,
  Minus,
  RefreshCw,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { LogoMark } from "@/components/shared/Logo";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { findModel } from "@/lib/coding-agent/models";
import { cn } from "@/lib/utils";

// DevStation's own figures, for the accounts in ADMIN_EMAILS: how many people
// sign up and build, how the agent does, what the models cost, and who asked
// for Pro. One call to api/admin/stats (devstation_dashboard in the database)
// for the chosen period, each figure beside the same period before it.

export const Route = createFileRoute("/admin/stats")({
  head: () => ({
    meta: [{ title: "Analytics · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: StatsPage,
});

// ------------------------------------------------------------------ data

interface Day {
  day: string;
  signups: number;
  builders: number;
  turns: number;
  failed: number;
  cost_free: number;
  cost_premium: number;
  visits: number;
  projects_created: number;
  messages: number;
}

interface Dashboard {
  range: { days: number; start: string; end: string; prev_start: string };
  kpis: Record<string, number>;
  series: Day[];
  funnel: { signed_up: number; confirmed: number; built: number; claimed: number; pro: number };
  models: { model: string; turns: number; failed: number; avg_steps: number; cost: number }[];
  top_accounts: {
    account: string;
    owner: string;
    turns: number;
    projects: number;
    cost: number;
    last_active: string;
    plan: string;
  }[];
  recent_accounts: {
    account: string;
    owner: string;
    created_at: string;
    confirmed: boolean;
    last_sign_in_at: string | null;
    turns: number;
    plan: string;
  }[];
  generated_at: string;
}

interface Payload {
  dashboard: Dashboard;
  proRequests: {
    owner: string;
    plan: string;
    contact: string | null;
    pro_requested_at: string | null;
  }[];
}

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

// ------------------------------------------------------------------ format

const num = (n: number) => Math.round(Number(n) || 0).toLocaleString("en-US");
const compact = (n: number) =>
  Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    Number(n) || 0,
  );
const usd = (n: number) => {
  const v = Number(n) || 0;
  return v >= 100
    ? `$${Math.round(v).toLocaleString("en-US")}`
    : `$${v.toFixed(v >= 1 || v === 0 ? 2 : 3)}`;
};
const pct = (n: number) => `${(Number(n) * 100).toFixed(n >= 0.1 || n === 0 ? 0 : 1)}%`;
const shortDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const when = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const modelName = (id: string) =>
  id === "auto" ? "Auto (Qwen 3.8 27B)" : (findModel(id)?.label ?? id);

/** Change against the previous period: null when there was nothing before. */
function change(now: number, before: number): number | null {
  if (!before) return null;
  return (now - before) / before;
}

// ------------------------------------------------------------------ page

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
      setError("Sign in on DevStation with an admin email, then open this page again.");
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
    <div className="viz min-h-dvh bg-background text-foreground">
      <style>{VIZ_TOKENS}</style>
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <a href="/" className="flex items-center gap-2.5">
            <LogoMark className="h-7 w-7" />
            <span className="text-[14px] font-semibold">DevStation</span>
            <span className="rounded-md border border-border px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
              Analytics
            </span>
          </a>
          <div className="ml-auto flex items-center gap-2">
            <RangePicker value={range} onChange={setRange} />
            <button
              onClick={() => void load(range)}
              disabled={loading}
              aria-label="Refresh"
              className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
            <ExportMenu />
            <a
              href="/"
              className="hidden items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" /> App
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-16 pt-6 sm:px-6">
        {error ? (
          <div className="mx-auto mt-16 max-w-md rounded-2xl border border-border bg-surface px-6 py-8 text-center">
            <p className="text-[14px] font-medium">The figures are not available</p>
            <p className="mt-1.5 text-[13px] text-muted-foreground">{error}</p>
          </div>
        ) : !d ? (
          <Skeleton />
        ) : (
          <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h1 className="text-[20px] font-semibold tracking-tight">Overview</h1>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  {shortDay(d.range.start)} – {shortDay(d.range.end)} (UTC), compared with the{" "}
                  {d.range.days} days before
                </p>
              </div>
              <p className="text-[11.5px] text-meta">Updated {when(d.generated_at)}</p>
            </div>

            <Kpis d={d} />
            <PlatformStrip
              d={d}
              pending={data!.proRequests.filter((r) => r.plan !== "pro").length}
            />

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Agent turns" note="Per day, by how they ended">
                <TurnsChart series={d.series} />
              </Card>
              <Card title="People" note="New accounts and people who built, per day">
                <PeopleChart series={d.series} />
              </Card>
              <Card title="Model cost" note="Estimated, per day, free and premium models">
                <CostChart series={d.series} />
              </Card>
              <Card title="Site visits" note="Unique visitors per day">
                <VisitsChart series={d.series} />
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Card title="Sign-up funnel" note="Every account so far" className="lg:col-span-2">
                <Funnel f={d.funnel} />
              </Card>
              <Card
                title="Models"
                note={`Turns in the last ${d.range.days} days`}
                className="lg:col-span-3"
              >
                <ModelsTable models={d.models} />
              </Card>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card title="Most active accounts" note={`By turns, last ${d.range.days} days`}>
                <TopAccounts rows={d.top_accounts} />
              </Card>
              <Card title="Newest accounts" note="Latest sign-ups">
                <RecentAccounts rows={d.recent_accounts} />
              </Card>
            </div>

            <Card title="Pro access" note="Requests waiting, and accounts on Pro">
              <ProTable rows={data!.proRequests} onSet={setPlan} />
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}

// Chart colours: the validated categorical order (blue, orange) and the
// critical status red, stepped separately for the dark and light surfaces.
const VIZ_TOKENS = `
.viz { --s1: #3987e5; --s2: #d95926; --crit: #e66767; --grid: color-mix(in oklab, var(--border) 70%, transparent); }
html.light .viz { --s1: #2a78d6; --s2: #eb6834; --crit: #e34948; }
`;

// ------------------------------------------------------------------ header bits

function RangePicker({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Period"
      className="flex rounded-lg border border-border p-0.5"
    >
      {RANGES.map((r) => (
        <button
          key={r}
          role="radio"
          aria-checked={value === r}
          onClick={() => onChange(r)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[12px] font-medium tabular-nums transition",
            value === r
              ? "bg-surface-2 text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r}d
        </button>
      ))}
    </div>
  );
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const files: [string, string, string][] = [
    ["turns.csv", "Agent turns", "Every turn, accounts pseudonymised"],
    ["daily.csv", "Daily site figures", "Visits, projects and messages per day"],
    ["summary.json", "Summary for publishing", "Totals and daily figures, no accounts"],
  ];
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12.5px] font-medium text-foreground transition hover:bg-surface-2"
      >
        <Download className="h-3.5 w-3.5" /> Export
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-30 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          {files.map(([file, label, hint]) => (
            <a
              key={file}
              href={`/api/admin/stats?download=${file}`}
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2.5 transition hover:bg-surface-2"
            >
              <span className="block text-[12.5px] font-medium text-foreground">{label}</span>
              <span className="block text-[11.5px] text-muted-foreground">{hint}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ KPIs

function Kpis({ d }: { d: Dashboard }) {
  const k = d.kpis;
  const rate = (f: number, all: number) => (all ? f / all : 0);
  const tiles: {
    label: string;
    value: string;
    delta: number | null;
    /** Up is bad for this figure (failures, cost). */
    invert?: boolean;
    spark: number[];
    hint?: string;
  }[] = [
    {
      label: "New accounts",
      value: num(k.new_accounts),
      delta: change(k.new_accounts, k.new_accounts_prev),
      spark: d.series.map((s) => s.signups),
    },
    {
      label: "Active builders",
      value: num(k.builders),
      delta: change(k.builders, k.builders_prev),
      spark: d.series.map((s) => s.builders),
      hint: "Accounts that ran at least one turn",
    },
    {
      label: "Agent turns",
      value: num(k.turns),
      delta: change(k.turns, k.turns_prev),
      spark: d.series.map((s) => s.turns),
    },
    {
      label: "Success rate",
      value: k.turns ? pct(rate(k.finished, k.turns)) : "–",
      delta:
        k.turns && k.turns_prev
          ? rate(k.finished, k.turns) - rate(k.finished_prev, k.turns_prev)
          : null,
      spark: d.series.map((s) => (s.turns ? (s.turns - s.failed) / s.turns : 0)),
      hint: "Turns that finished without an error",
    },
    {
      label: "Model cost",
      value: usd(k.cost),
      delta: change(k.cost, k.cost_prev),
      invert: true,
      spark: d.series.map((s) => s.cost_free + s.cost_premium),
      hint: "Estimated from tokens and list prices",
    },
    {
      label: "Visits",
      value: num(k.visits),
      delta: change(k.visits, k.visits_prev),
      spark: d.series.map((s) => s.visits),
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          title={t.hint}
          className="flex flex-col rounded-2xl border border-border bg-surface p-4"
        >
          <p className="text-[12px] font-medium text-muted-foreground">{t.label}</p>
          <p className="mt-1.5 text-[24px] font-semibold leading-none tracking-tight tabular-nums">
            {t.value}
          </p>
          <div className="mt-2 flex items-end justify-between gap-2">
            <Delta value={t.delta} invert={t.invert} points={t.label === "Success rate"} />
            <Sparkline values={t.spark} />
          </div>
        </div>
      ))}
    </section>
  );
}

function Delta({
  value,
  invert,
  points,
}: {
  value: number | null;
  invert?: boolean;
  points?: boolean;
}) {
  if (value === null || !Number.isFinite(value)) {
    return <span className="text-[11.5px] text-meta">no earlier data</span>;
  }
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const good = flat ? null : invert ? !up : up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = points
    ? `${up ? "+" : ""}${(value * 100).toFixed(1)} pts`
    : `${up ? "+" : ""}${(value * 100).toFixed(Math.abs(value) >= 0.1 ? 0 : 1)}%`;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11.5px] font-medium tabular-nums",
        good === null
          ? "bg-surface-2 text-muted-foreground"
          : good
            ? "bg-success/10 text-success"
            : "bg-danger/10 text-danger",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {flat ? "0%" : text}
      <span className="sr-only"> against the previous period</span>
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 64;
  const h = 22;
  const max = Math.max(...values, 0);
  if (!values.length || max === 0) return <span className="h-[22px] w-16" aria-hidden />;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`,
  );
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="shrink-0">
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke="var(--s1)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlatformStrip({ d, pending }: { d: Dashboard; pending: number }) {
  const k = d.kpis;
  const items: [string, string, React.ReactNode?][] = [
    ["Accounts", num(k.accounts)],
    ["Projects saved", num(k.projects_saved)],
    [
      "Launch credits",
      `${num(k.credits_claimed)} / ${num(k.credits_total)}`,
      <Progress key="p" value={k.credits_total ? k.credits_claimed / k.credits_total : 0} />,
    ],
    ["Premium credit used", usd(k.credit_used)],
    ["Pro accounts", num(k.pro_accounts)],
    ["Waiting for Pro", num(pending)],
  ];
  return (
    <section className="grid grid-cols-2 divide-border overflow-hidden rounded-2xl border border-border bg-surface sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
      {items.map(([label, value, extra]) => (
        <div
          key={label}
          className="border-border px-4 py-3 [&:not(:last-child)]:border-b lg:border-b-0"
        >
          <p className="text-[11.5px] text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-[15px] font-semibold tabular-nums">{value}</p>
          {extra}
        </div>
      ))}
    </section>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full bg-[var(--s1)]"
        style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ charts

function Card({
  title,
  note,
  className,
  children,
}: {
  title: string;
  note?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5", className)}
    >
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {note && <p className="mt-0.5 text-[12px] text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

const AXIS = {
  tick: { fill: "var(--meta)", fontSize: 11 },
  tickLine: false,
  axisLine: false,
} as const;

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map(([label, color]) => (
        <span
          key={label}
          className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground"
        >
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

interface TipProps {
  active?: boolean;
  label?: string;
  payload?: { name: string; value: number; color: string; dataKey: string }[];
  format?: (n: number) => string;
  total?: boolean;
}

function Tip({ active, label, payload, format = num, total }: TipProps) {
  if (!active || !payload?.length) return null;
  const sum = payload.reduce((a, p) => a + (Number(p.value) || 0), 0);
  return (
    <div className="min-w-[150px] rounded-lg border border-border bg-surface px-3 py-2 shadow-lg">
      <p className="text-[11.5px] font-medium text-muted-foreground">
        {label ? shortDay(label) : ""}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey} className="mt-1 flex items-center gap-2 text-[12px]">
          <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-medium tabular-nums text-foreground">
            {format(p.value)}
          </span>
        </p>
      ))}
      {total && payload.length > 1 && (
        <p className="mt-1.5 flex border-t border-border pt-1.5 text-[12px]">
          <span className="text-muted-foreground">Total</span>
          <span className="ml-auto font-medium tabular-nums text-foreground">{format(sum)}</span>
        </p>
      )}
    </div>
  );
}

const CHART_H = 220;
const tickDays = (series: Day[]) => {
  const every = Math.max(1, Math.ceil(series.length / 7));
  return series.filter((_, i) => i % every === 0 || i === series.length - 1).map((s) => s.day);
};

function Empty() {
  return (
    <div
      className="grid place-items-center rounded-xl bg-surface-2/50 text-[12.5px] text-muted-foreground"
      style={{ height: CHART_H }}
    >
      Nothing in this period yet
    </div>
  );
}

function TurnsChart({ series }: { series: Day[] }) {
  const rows = series.map((s) => ({ day: s.day, finished: s.turns - s.failed, failed: s.failed }));
  if (!rows.some((r) => r.finished || r.failed)) return <Empty />;
  return (
    <>
      <Legend
        items={[
          ["Finished", "var(--s1)"],
          ["Ended in an error", "var(--crit)"],
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart
          data={rows}
          margin={{ top: 4, right: 4, bottom: 0, left: -18 }}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" ticks={tickDays(series)} tickFormatter={shortDay} {...AXIS} />
          <YAxis allowDecimals={false} tickFormatter={compact} {...AXIS} />
          <Tooltip cursor={{ fill: "var(--grid)" }} content={<Tip total />} />
          <Bar
            isAnimationActive={false}
            dataKey="finished"
            name="Finished"
            stackId="t"
            fill="var(--s1)"
          />
          <Bar
            isAnimationActive={false}
            dataKey="failed"
            name="Ended in an error"
            stackId="t"
            fill="var(--crit)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function PeopleChart({ series }: { series: Day[] }) {
  if (!series.some((s) => s.signups || s.builders)) return <Empty />;
  return (
    <>
      <Legend
        items={[
          ["New accounts", "var(--s1)"],
          ["Active builders", "var(--s2)"],
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_H}>
        <LineChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" ticks={tickDays(series)} tickFormatter={shortDay} {...AXIS} />
          <YAxis allowDecimals={false} tickFormatter={compact} {...AXIS} />
          <Tooltip cursor={{ stroke: "var(--meta)", strokeDasharray: "3 3" }} content={<Tip />} />
          <Line
            isAnimationActive={false}
            type="monotone"
            dataKey="signups"
            name="New accounts"
            stroke="var(--s1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
          />
          <Line
            isAnimationActive={false}
            type="monotone"
            dataKey="builders"
            name="Active builders"
            stroke="var(--s2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}

function CostChart({ series }: { series: Day[] }) {
  if (!series.some((s) => s.cost_free || s.cost_premium)) return <Empty />;
  return (
    <>
      <Legend
        items={[
          ["Free model", "var(--s1)"],
          ["Premium models", "var(--s2)"],
        ]}
      />
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart
          data={series}
          margin={{ top: 4, right: 4, bottom: 0, left: -8 }}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="day" ticks={tickDays(series)} tickFormatter={shortDay} {...AXIS} />
          <YAxis tickFormatter={(v: number) => `$${compact(v)}`} {...AXIS} />
          <Tooltip cursor={{ fill: "var(--grid)" }} content={<Tip format={usd} total />} />
          <Bar
            isAnimationActive={false}
            dataKey="cost_free"
            name="Free model"
            stackId="c"
            fill="var(--s1)"
          />
          <Bar
            isAnimationActive={false}
            dataKey="cost_premium"
            name="Premium models"
            stackId="c"
            fill="var(--s2)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function VisitsChart({ series }: { series: Day[] }) {
  if (!series.some((s) => s.visits)) return <Empty />;
  return (
    <ResponsiveContainer width="100%" height={CHART_H + 24}>
      <AreaChart data={series} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
        <defs>
          <linearGradient id="visits-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--s1)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--s1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--grid)" />
        <XAxis dataKey="day" ticks={tickDays(series)} tickFormatter={shortDay} {...AXIS} />
        <YAxis allowDecimals={false} tickFormatter={compact} {...AXIS} />
        <Tooltip cursor={{ stroke: "var(--meta)", strokeDasharray: "3 3" }} content={<Tip />} />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="visits"
          name="Visits"
          stroke="var(--s1)"
          strokeWidth={2}
          fill="url(#visits-fill)"
          activeDot={{ r: 4, stroke: "var(--surface)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ------------------------------------------------------------------ funnel and tables

function Funnel({ f }: { f: Dashboard["funnel"] }) {
  const steps: [string, number][] = [
    ["Signed up", f.signed_up],
    ["Confirmed their email", f.confirmed],
    ["Built something", f.built],
    ["Claimed launch credit", f.claimed],
    ["On Pro", f.pro],
  ];
  const top = Math.max(f.signed_up, 1);
  return (
    <ol className="space-y-3">
      {steps.map(([label, n], i) => (
        <li key={label}>
          <div className="flex items-baseline justify-between gap-2 text-[12.5px]">
            <span className="text-foreground">{label}</span>
            <span className="tabular-nums">
              <span className="font-medium">{num(n)}</span>
              {i > 0 && <span className="ml-2 text-muted-foreground">{pct(n / top)}</span>}
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-[var(--s1)]"
              style={{ width: `${(n / top) * 100}%`, opacity: 1 - i * 0.14 }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function Table({
  head,
  children,
  empty,
}: {
  head: { label: string; right?: boolean }[];
  children: React.ReactNode;
  empty?: boolean;
}) {
  if (empty)
    return <p className="py-6 text-center text-[12.5px] text-muted-foreground">None yet</p>;
  return (
    <div className="-mx-4 overflow-x-auto sm:-mx-5">
      <table className="w-full min-w-[520px] text-[12.5px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-meta">
            {head.map((h) => (
              <th
                key={h.label}
                className={cn(
                  "whitespace-nowrap px-4 pb-2 font-medium first:pl-4 sm:first:pl-5 last:pr-4 sm:last:pr-5",
                  h.right && "text-right",
                )}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border [&_td]:px-4 [&_td]:py-2.5 [&_td:first-child]:sm:pl-5 [&_td:last-child]:sm:pr-5">
          {children}
        </tbody>
      </table>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string }) {
  return plan === "pro" ? (
    <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
      Pro
    </span>
  ) : (
    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      Free
    </span>
  );
}

function Account({ name }: { name: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-2 text-[10.5px] font-semibold uppercase text-muted-foreground">
        {name.replace(/^0x/, "").slice(0, 2)}
      </span>
      <span className="truncate text-foreground" title={name}>
        {name}
      </span>
    </span>
  );
}

function ModelsTable({ models }: { models: Dashboard["models"] }) {
  const total = models.reduce((a, m) => a + Number(m.turns), 0) || 1;
  return (
    <Table
      empty={!models.length}
      head={[
        { label: "Model" },
        { label: "Share" },
        { label: "Turns", right: true },
        { label: "Success", right: true },
        { label: "Avg steps", right: true },
        { label: "Cost", right: true },
      ]}
    >
      {models.map((m) => (
        <tr key={m.model}>
          <td className="whitespace-nowrap font-medium text-foreground">{modelName(m.model)}</td>
          <td className="w-32">
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className="h-full rounded-full bg-[var(--s1)]"
                style={{ width: `${(m.turns / total) * 100}%` }}
              />
            </div>
          </td>
          <td className="text-right tabular-nums">{num(m.turns)}</td>
          <td className="text-right tabular-nums">
            {pct(m.turns ? (m.turns - m.failed) / m.turns : 0)}
          </td>
          <td className="text-right tabular-nums">{Number(m.avg_steps).toFixed(1)}</td>
          <td className="text-right tabular-nums">{usd(m.cost)}</td>
        </tr>
      ))}
    </Table>
  );
}

function TopAccounts({ rows }: { rows: Dashboard["top_accounts"] }) {
  return (
    <Table
      empty={!rows.length}
      head={[
        { label: "Account" },
        { label: "Plan" },
        { label: "Turns", right: true },
        { label: "Projects", right: true },
        { label: "Cost", right: true },
        { label: "Active", right: true },
      ]}
    >
      {rows.map((r) => (
        <tr key={r.owner}>
          <td className="max-w-[190px]">
            <Account name={r.account} />
          </td>
          <td>
            <PlanBadge plan={r.plan} />
          </td>
          <td className="text-right tabular-nums">{num(r.turns)}</td>
          <td className="text-right tabular-nums">{num(r.projects)}</td>
          <td className="text-right tabular-nums">{usd(r.cost)}</td>
          <td className="whitespace-nowrap text-right text-muted-foreground">
            {when(r.last_active)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function RecentAccounts({ rows }: { rows: Dashboard["recent_accounts"] }) {
  return (
    <Table
      empty={!rows.length}
      head={[
        { label: "Account" },
        { label: "Status" },
        { label: "Turns", right: true },
        { label: "Joined", right: true },
        { label: "Last sign-in", right: true },
      ]}
    >
      {rows.map((r) => (
        <tr key={r.owner}>
          <td className="max-w-[190px]">
            <Account name={r.account} />
          </td>
          <td>
            {r.confirmed ? (
              <PlanBadge plan={r.plan} />
            ) : (
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Unconfirmed
              </span>
            )}
          </td>
          <td className="text-right tabular-nums">{num(r.turns)}</td>
          <td className="whitespace-nowrap text-right text-muted-foreground">
            {when(r.created_at)}
          </td>
          <td className="whitespace-nowrap text-right text-muted-foreground">
            {when(r.last_sign_in_at)}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function ProTable({
  rows,
  onSet,
}: {
  rows: Payload["proRequests"];
  onSet: (owner: string, plan: "pro" | "free") => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => Number(a.plan === "pro") - Number(b.plan === "pro")),
    [rows],
  );
  const act = async (owner: string, plan: "pro" | "free") => {
    setBusy(owner);
    await onSet(owner, plan).finally(() => setBusy(null));
  };
  return (
    <Table
      empty={!rows.length}
      head={[
        { label: "Contact" },
        { label: "Plan" },
        { label: "Requested", right: true },
        { label: "", right: true },
      ]}
    >
      {sorted.map((r) => (
        <tr key={r.owner}>
          <td className="max-w-[280px]">
            {r.contact ? (
              <a href={`mailto:${r.contact}`} className="truncate text-foreground hover:underline">
                {r.contact}
              </a>
            ) : (
              <span className="font-mono text-[11.5px] text-muted-foreground">{r.owner}</span>
            )}
          </td>
          <td>
            <PlanBadge plan={r.plan} />
          </td>
          <td className="whitespace-nowrap text-right text-muted-foreground">
            {r.pro_requested_at ? when(r.pro_requested_at) : "–"}
          </td>
          <td className="text-right">
            {r.plan === "pro" ? (
              <button
                onClick={() => void act(r.owner, "free")}
                disabled={busy === r.owner}
                className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition hover:border-danger/50 hover:text-danger disabled:opacity-60"
              >
                Revoke
              </button>
            ) : (
              <button
                onClick={() => void act(r.owner, "pro")}
                disabled={busy === r.owner}
                className="rounded-lg bg-primary px-2.5 py-1 text-[12px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
              >
                Grant Pro
              </button>
            )}
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" /> Loading the figures
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-[108px] animate-pulse rounded-2xl bg-surface-2/60" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[300px] animate-pulse rounded-2xl bg-surface-2/60" />
        ))}
      </div>
    </div>
  );
}
