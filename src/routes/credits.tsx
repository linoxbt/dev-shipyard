import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Crown, Gift, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import {
  AXIS,
  CHART_H,
  Card,
  Delta,
  Empty,
  Legend,
  RangePicker,
  Shell,
  Table,
  Tip,
  Unavailable,
  change,
  compact,
  modelName,
  num,
  shortDay,
  tickDays,
  usd,
  when,
  type Range,
} from "@/components/stats/StatsDashboard";
import { ModelLogo } from "@/components/coding-agent/pickers";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { changePlan, type Access } from "@/lib/coding-agent/account-client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/lib/appgen/projects";
import { cn } from "@/lib/utils";

// An account's credit and usage, laid out the way a model provider's billing
// page is: the balance and what to do about it, then what was used, per day
// and per model, then every recent model call, then what was added to the
// credit. Qwen is free and never touches the credit; premium models spend it.

export const Route = createFileRoute("/credits")({
  head: () => ({
    meta: [{ title: "Credits · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: CreditsPage,
});

interface Usage {
  range: { days: number; start: string; end: string };
  totals: {
    cost: number;
    cost_prev: number;
    billed: number;
    billed_prev: number;
    calls: number;
    calls_prev: number;
    input: number;
    output: number;
    tokens_prev: number;
  };
  series: { day: string; model: string; cost: number; calls: number }[];
  days: string[];
  models: {
    model: string;
    premium: boolean;
    calls: number;
    input: number;
    output: number;
    cost: number;
  }[];
  recent: {
    created_at: string;
    model: string;
    premium: boolean;
    input: number;
    output: number;
    cost: number;
    workspace: string;
  }[];
  credits: { claimed_at: string; amount_usd: number }[];
  plan: { plan: string; updated_at: string | null; pro_requested_at: string | null } | null;
}

/** Series colours in their fixed order; anything past three folds into Other. */
const SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)"];

function CreditsPage() {
  const [range, setRange] = useState<Range>(30);
  const [access, setAccess] = useState<Access | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => {
    useAuth.getState().init();
    useProjects.getState().hydrate();
  }, []);

  const load = useCallback(async (days: Range) => {
    setLoading(true);
    try {
      const res = await fetchWithGrant(`/api/credits?days=${days}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || "Your usage could not be read.");
      setAccess(body.access);
      setUsage(body.usage);
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
      setError("Sign in on DevStation to see your credit and usage.");
      return;
    }
    void load(range);
  }, [authReady, signedIn, range, load]);

  return (
    <Shell
      label="Credits"
      controls={
        <button
          onClick={() => void load(range)}
          disabled={loading}
          aria-label="Refresh"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      }
    >
      {error ? (
        <Unavailable title="Credits are not available" message={error} />
      ) : !access || !usage ? (
        <p className="flex items-center gap-2 py-10 text-[13px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading your credit
        </p>
      ) : (
        <div className={cn("mx-auto max-w-5xl space-y-6", loading && "opacity-60")}>
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Credits</h1>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              Qwen 3.8 27B is free and never uses credit. Claude, GPT and Gemini spend it at each
              model&apos;s real cost.
            </p>
          </div>
          <Balance access={access} onChange={setAccess} />

          <div className="flex flex-wrap items-end justify-between gap-2 pt-2">
            <div>
              <h2 className="text-[16px] font-semibold">Usage</h2>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {shortDay(usage.range.start)} – {shortDay(usage.range.end)} (UTC), compared with the{" "}
                {usage.range.days} days before
              </p>
            </div>
            <RangePicker value={range} onChange={setRange} />
          </div>
          <Totals usage={usage} />
          <Card title="Spend" note="Per day, by model (estimated for the free model)">
            <SpendChart usage={usage} />
          </Card>
          <Card title="By model" note={`Last ${usage.range.days} days`}>
            <ModelTable models={usage.models} />
          </Card>
          <Card title="Recent activity" note="Your latest model calls, newest first">
            <Activity rows={usage.recent} />
          </Card>
          <Card title="Credit history" note="What was added to your account">
            <History usage={usage} />
          </Card>
        </div>
      )}
    </Shell>
  );
}

// ------------------------------------------------------------------ balance

function Balance({ access, onChange }: { access: Access; onChange: (a: Access) => void }) {
  const [busy, setBusy] = useState<null | "claim" | "request_pro">(null);
  const act = async (action: "claim" | "request_pro") => {
    setBusy(action);
    const r = await changePlan(action);
    setBusy(null);
    if (!r.ok) return void toast.error(r.message);
    onChange(r.data);
    toast.success(
      action === "claim"
        ? "$5 of launch credit is yours. Every model is unlocked."
        : "Pro requested. You will hear from us soon.",
    );
  };
  const pro = access.plan === "pro";
  const used = access.claimed ? Math.min(1, access.spent / access.claimed) : 0;

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
        <p className="text-[12.5px] font-medium text-muted-foreground">
          {pro ? "Plan" : "Credit balance"}
        </p>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-[36px] font-semibold leading-none tracking-tight tabular-nums">
            {pro ? "Pro" : usd(access.balance)}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {pro
              ? "Every model, with no credit to run out"
              : access.claimed > 0
                ? `of ${usd(access.claimed)} launch credit · ${usd(access.spent)} used`
                : "No credit yet: Qwen is free, premium models need credit or Pro"}
          </p>
        </div>
        {!pro && access.claimed > 0 && (
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div
              className={cn(
                "h-full rounded-full",
                access.balance <= 0.5 ? "bg-[var(--crit)]" : "bg-[var(--s1)]",
              )}
              style={{ width: `${(1 - used) * 100}%` }}
            />
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {!pro && access.claimed === 0 && (
            <button
              onClick={() => void act("claim")}
              disabled={!!busy || access.slotsLeft === 0 || !access.available}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
            >
              {busy === "claim" ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Gift className="h-4 w-4" />
              )}
              {access.slotsLeft === 0 ? "Launch credit all claimed" : "Claim $5 launch credit"}
            </button>
          )}
          {!pro &&
            (access.proRequested ? (
              <span className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] text-muted-foreground">
                <Check className="h-4 w-4 text-success" /> Pro requested: we will be in touch
              </span>
            ) : (
              <button
                onClick={() => void act("request_pro")}
                disabled={!!busy || !access.available}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-[13px] font-medium transition disabled:opacity-50",
                  access.claimed === 0
                    ? "border border-border text-foreground hover:bg-surface-2"
                    : "bg-primary text-primary-foreground hover:bg-primary-hover",
                )}
              >
                {busy === "request_pro" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Crown className="h-4 w-4" />
                )}
                Upgrade to Pro
              </button>
            ))}
          {pro && (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success/10 px-4 text-[13px] font-medium text-success">
              <Check className="h-4 w-4" /> You are on Pro
            </span>
          )}
        </div>
        {!pro && access.claimed === 0 && access.slotsLeft > 0 && (
          <p className="mt-2 text-[11.5px] text-meta">
            $5 each for the first 20 accounts · {access.slotsLeft} left
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-[12.5px] font-medium text-muted-foreground">What you can use</p>
        <ul className="mt-3 space-y-2.5 text-[13px]">
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[var(--s1)]" />
            <span>
              <span className="font-medium text-foreground">Qwen 3.8 27B</span>
              <span className="block text-[12px] text-muted-foreground">Free, every account</span>
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Crown className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium text-foreground">Claude, GPT and Gemini</span>
              <span className="block text-[12px] text-muted-foreground">
                {access.premium ? "Unlocked on this account" : "With launch credit or Pro"}
              </span>
            </span>
          </li>
        </ul>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ usage

function Totals({ usage }: { usage: Usage }) {
  const t = usage.totals;
  const tiles: {
    label: string;
    value: string;
    delta: number | null;
    invert?: boolean;
    hint?: string;
  }[] = [
    {
      label: "Billed to credit",
      value: usd(t.billed),
      delta: change(t.billed, t.billed_prev),
      invert: true,
      hint: "What premium models spent",
    },
    {
      label: "Model cost",
      value: usd(t.cost),
      delta: change(t.cost, t.cost_prev),
      invert: true,
      hint: "Everything, the free model's estimated cost included",
    },
    { label: "Model calls", value: num(t.calls), delta: change(t.calls, t.calls_prev) },
    {
      label: "Tokens",
      value: compact(Number(t.input) + Number(t.output)),
      delta: change(Number(t.input) + Number(t.output), t.tokens_prev),
      hint: `${num(t.input)} in, ${num(t.output)} out`,
    },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((tile) => (
        <div key={tile.label} className="rounded-2xl border border-border bg-surface p-4">
          <p className="text-[12px] font-medium text-muted-foreground">{tile.label}</p>
          <p className="mt-1.5 text-[22px] font-semibold leading-none tracking-tight tabular-nums">
            {tile.value}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Delta value={tile.delta} invert={tile.invert} />
            {tile.hint && <span className="text-[11px] text-meta">{tile.hint}</span>}
          </div>
        </div>
      ))}
    </section>
  );
}

function SpendChart({ usage }: { usage: Usage }) {
  const { rows, keys } = useMemo(() => {
    // The three models that cost most get a colour each; the rest are Other.
    const totals = new Map<string, number>();
    for (const s of usage.series) totals.set(s.model, (totals.get(s.model) ?? 0) + Number(s.cost));
    const top = [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([m]) => m);
    const keys = [
      ...top.map((m, i) => ({ key: m, label: modelName(m), color: SLOTS[i] })),
      ...(totals.size > top.length
        ? [{ key: "other", label: "Other", color: "var(--other)" }]
        : []),
    ];
    const rows = usage.days.map((day) => {
      const row: Record<string, number | string> = { day };
      for (const k of keys) row[k.key] = 0;
      for (const s of usage.series.filter((x) => x.day === day)) {
        const k = top.includes(s.model) ? s.model : "other";
        row[k] = Number(row[k]) + Number(s.cost);
      }
      return row;
    });
    return { rows, keys };
  }, [usage]);

  if (!usage.series.length) return <Empty />;
  return (
    <>
      <Legend items={keys.map((k) => [k.label, k.color])} />
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart
          data={rows}
          margin={{ top: 4, right: 4, bottom: 0, left: -8 }}
          barCategoryGap="22%"
        >
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="day"
            ticks={tickDays(usage.days.map((day) => ({ day })))}
            tickFormatter={shortDay}
            {...AXIS}
          />
          <YAxis tickFormatter={(v: number) => `$${compact(v)}`} {...AXIS} />
          <Tooltip cursor={{ fill: "var(--grid)" }} content={<Tip format={usd} total />} />
          {keys.map((k, i) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              name={k.label}
              stackId="s"
              fill={k.color}
              isAnimationActive={false}
              radius={i === keys.length - 1 ? [4, 4, 0, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

function ModelCell({ id }: { id: string }) {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap font-medium text-foreground">
      <ModelLogo id={id === "auto" ? "qwen-3.8-27b" : id} className="h-3.5 w-3.5" />
      {modelName(id)}
    </span>
  );
}

function Billing({ premium }: { premium: boolean }) {
  return premium ? (
    <span className="rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium text-primary">
      Credit
    </span>
  ) : (
    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
      Free
    </span>
  );
}

function ModelTable({ models }: { models: Usage["models"] }) {
  return (
    <Table
      empty={!models.length}
      head={[
        { label: "Model" },
        { label: "Billing" },
        { label: "Calls", right: true },
        { label: "Input", right: true },
        { label: "Output", right: true },
        { label: "Cost", right: true },
      ]}
    >
      {models.map((m) => (
        <tr key={m.model}>
          <td>
            <ModelCell id={m.model} />
          </td>
          <td>
            <Billing premium={m.premium} />
          </td>
          <td className="text-right tabular-nums">{num(m.calls)}</td>
          <td className="text-right tabular-nums">{compact(m.input)}</td>
          <td className="text-right tabular-nums">{compact(m.output)}</td>
          <td className="text-right tabular-nums">{usd(m.cost)}</td>
        </tr>
      ))}
    </Table>
  );
}

function Activity({ rows }: { rows: Usage["recent"] }) {
  const projects = useProjects((s) => s.projects);
  const nameOf = (workspace: string) =>
    projects.find((p) => p.workspaceId === workspace)?.name ?? "A project";
  return (
    <Table
      empty={!rows.length}
      head={[
        { label: "Time" },
        { label: "Model" },
        { label: "Project" },
        { label: "Tokens", right: true },
        { label: "Cost", right: true },
        { label: "", right: true },
      ]}
    >
      {rows.map((r, i) => (
        <tr key={`${r.created_at}-${i}`}>
          <td
            className="whitespace-nowrap text-muted-foreground"
            title={new Date(r.created_at).toLocaleString()}
          >
            {when(r.created_at)}
          </td>
          <td>
            <ModelCell id={r.model} />
          </td>
          <td className="max-w-[200px] truncate text-foreground/90">{nameOf(r.workspace)}</td>
          <td className="whitespace-nowrap text-right tabular-nums text-muted-foreground">
            {compact(r.input)} → {compact(r.output)}
          </td>
          <td className="text-right tabular-nums">{usd(r.cost)}</td>
          <td className="text-right">
            <Billing premium={r.premium} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function History({ usage }: { usage: Usage }) {
  const items: { at: string; label: string; amount: string }[] = [
    ...usage.credits.map((c) => ({
      at: c.claimed_at,
      label: "Launch credit",
      amount: `+${usd(Number(c.amount_usd))}`,
    })),
    ...(usage.plan?.pro_requested_at
      ? [{ at: usage.plan.pro_requested_at, label: "Asked for Pro", amount: "" }]
      : []),
    ...(usage.plan?.plan === "pro" && usage.plan.updated_at
      ? [{ at: usage.plan.updated_at, label: "Moved to Pro", amount: "Every model" }]
      : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Table
      empty={!items.length}
      head={[{ label: "Date" }, { label: "What" }, { label: "Amount", right: true }]}
    >
      {items.map((it) => (
        <tr key={`${it.at}-${it.label}`}>
          <td className="whitespace-nowrap text-muted-foreground">
            {new Date(it.at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </td>
          <td className="text-foreground">{it.label}</td>
          <td className="text-right font-medium tabular-nums text-foreground">{it.amount}</td>
        </tr>
      ))}
    </Table>
  );
}
