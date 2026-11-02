import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  CreditCard,
  Crown,
  ExternalLink,
  Gift,
  LoaderCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
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
import { Modal } from "@/components/coding-agent/primitives";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import {
  changePlan,
  confirmPayment,
  fetchBilling,
  openBillingPortal,
  startCheckout,
  type Access,
  type BillingConfig,
} from "@/lib/coding-agent/account-client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/lib/appgen/projects";
import { cn } from "@/lib/utils";

// An account's credit, plan and usage, laid out the way a model provider's
// billing page is: the balance and what to do about it (add credit, Pro),
// today's free allowance, the plans, then what was used per day and per
// model, every recent model call, and every credit and payment.
//
// The economics (lib/billing/config.server.ts): the free model is free up to
// a daily allowance, every other call is charged to credit at the model's
// price plus a margin, and Pro is a monthly plan with credit included.

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
    billed: number;
  }[];
  recent: {
    created_at: string;
    model: string;
    premium: boolean;
    input: number;
    output: number;
    cost: number;
    billed: number;
    workspace: string;
  }[];
  credits: { claimed_at: string; amount_usd: number }[];
  ledger: { created_at: string; amount_usd: number; kind: string; note: string }[];
  payments: {
    created_at: string;
    provider: "stripe" | "paystack";
    kind: "topup" | "pro";
    amount_usd: number;
    currency: string;
  }[];
  plan: {
    plan: string;
    billing: string | null;
    pro_until: string | null;
    updated_at: string | null;
    pro_requested_at: string | null;
  } | null;
}

/** Series colours in their fixed order; anything past three folds into Other. */
const SLOTS = ["var(--s1)", "var(--s2)", "var(--s3)"];

/** Prices and allowances read in cents: "$0.50", not "$0.500". */
const cents = (n: number) => `$${(Number(n) || 0).toFixed(2)}`;

const PROVIDER_LABEL = { stripe: "Card (Stripe)", paystack: "Paystack" } as const;
const PROVIDER_HINT = {
  stripe: "Visa, Mastercard, Amex, Apple Pay, Google Pay",
  paystack: "Cards, bank transfer and USSD",
} as const;

function CreditsPage() {
  const [range, setRange] = useState<Range>(30);
  const [access, setAccess] = useState<Access | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [billing, setBilling] = useState<BillingConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => {
    useAuth.getState().init();
    useProjects.getState().hydrate();
    void fetchBilling().then(setBilling);
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

  // Back from a payment page: apply it now (the gateway's webhook may still
  // be on its way; a payment is applied once whichever arrives first).
  useEffect(() => {
    if (!authReady || !signedIn) return;
    const q = new URLSearchParams(window.location.search);
    const paid = q.get("paid");
    const id =
      paid === "stripe"
        ? q.get("session_id")
        : paid === "paystack"
          ? (q.get("reference") ?? q.get("trxref"))
          : null;
    if (q.get("cancelled")) toast.message("Payment cancelled. Nothing was charged.");
    if (q.get("add")) setAdding(true);
    if (paid || q.get("cancelled") || q.get("add")) {
      window.history.replaceState(null, "", "/credits");
    }
    if (!id || (paid !== "stripe" && paid !== "paystack")) return;
    void (async () => {
      const r = await confirmPayment(paid, id);
      if (r.ok && r.paid) toast.success("Payment received. Thank you!");
      else if (r.ok)
        toast.message("Your payment is processing. Credit appears as soon as it clears.");
      else toast.error(r.message);
      // Pro arrives with its invoice, a moment after the payment.
      await load(range);
      setTimeout(() => void load(range), 4000);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, signedIn]);

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
              Qwen 3.8 27B is free every day up to an allowance. Everything else is paid from credit
              at the model&apos;s own price
              {billing ? ` plus ${Math.round((billing.markup - 1) * 100)}%` : ""}.
            </p>
          </div>
          <Balance
            access={access}
            billing={billing}
            onChange={setAccess}
            onAdd={() => setAdding(true)}
          />
          <Plans access={access} billing={billing} onAdd={() => setAdding(true)} />

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
          <Card title="Spend" note="Per day, by model, at the models' own prices">
            <SpendChart usage={usage} />
          </Card>
          <Card title="By model" note={`Last ${usage.range.days} days`}>
            <ModelTable models={usage.models} />
          </Card>
          <Card title="Recent activity" note="Your latest model calls, newest first">
            <Activity rows={usage.recent} />
          </Card>
          <Card
            title="Credit and payments"
            note="Everything added to your account, and what you paid"
          >
            <History usage={usage} />
          </Card>
        </div>
      )}
      {adding && billing && <AddCredit billing={billing} onClose={() => setAdding(false)} />}
    </Shell>
  );
}

// ------------------------------------------------------------------ balance

function Balance({
  access,
  billing,
  onChange,
  onAdd,
}: {
  access: Access;
  billing: BillingConfig | null;
  onChange: (a: Access) => void;
  onAdd: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const claim = async () => {
    setBusy(true);
    const r = await changePlan("claim");
    setBusy(false);
    if (!r.ok) return void toast.error(r.message);
    onChange(r.data);
    toast.success("$5 of launch credit is yours.");
  };
  const unlimited = !!access.unlimited;
  const canPay = (billing?.providers.length ?? 0) > 0;
  const allowance = access.freeDailyUsd ?? null;
  const usedToday = access.freeUsedToday ?? 0;
  const lowCredit = !unlimited && access.claimed > 0 && access.balance < 1;

  return (
    <section className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-2xl border border-border bg-surface p-5 lg:col-span-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[12.5px] font-medium text-muted-foreground">
              {unlimited ? "Plan" : "Credit balance"}
            </p>
            <p className="mt-1.5 text-[36px] font-semibold leading-none tracking-tight tabular-nums">
              {unlimited ? "Unlimited" : usd(access.balance)}
            </p>
            <p className="mt-2 text-[12.5px] text-muted-foreground">
              {unlimited
                ? "Pro granted by DevStation: every model, no charges"
                : access.claimed > 0
                  ? `${usd(access.claimed)} added · ${usd(access.spent)} used`
                  : "No credit yet"}
            </p>
          </div>
          {access.plan === "pro" && (
            <span className="inline-flex items-center gap-1 rounded-md bg-primary/12 px-2 py-1 text-[11.5px] font-medium text-primary">
              <Crown className="h-3.5 w-3.5" /> Pro
            </span>
          )}
        </div>
        {lowCredit && (
          <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning">
            Your credit is running low. Add credit so premium models keep working.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          {!unlimited && (
            <button
              onClick={onAdd}
              disabled={!canPay}
              title={canPay ? undefined : "Payments open soon"}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Add credit
            </button>
          )}
          {!unlimited && (access.launch ?? 0) === 0 && access.slotsLeft > 0 && (
            <button
              onClick={() => void claim()}
              disabled={busy || !access.available}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-foreground transition hover:bg-surface-2 disabled:opacity-50"
            >
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Gift className="h-4 w-4" />
              )}
              Claim $5 launch credit
              <span className="text-[11.5px] font-normal text-meta">{access.slotsLeft} left</span>
            </button>
          )}
          {access.portal && <ManageBilling />}
        </div>
        {!canPay && !unlimited && (
          <p className="mt-2 text-[11.5px] text-meta">Card payments open soon.</p>
        )}
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-[12.5px] font-medium text-muted-foreground">Free today</p>
        {allowance === null ? (
          <>
            <p className="mt-1.5 text-[22px] font-semibold leading-none">No limit</p>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Qwen 3.8 27B, as much as you like
            </p>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[22px] font-semibold leading-none tabular-nums">
              {cents(Math.max(0, allowance - usedToday))}
              <span className="ml-1 text-[13px] font-normal text-muted-foreground">
                left of {cents(allowance)}
              </span>
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div
                className={cn(
                  "h-full rounded-full",
                  usedToday >= allowance ? "bg-[var(--crit)]" : "bg-[var(--s1)]",
                )}
                style={{
                  width: `${Math.min(100, (usedToday / Math.max(allowance, 0.0001)) * 100)}%`,
                }}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              Qwen 3.8 27B is free up to this much a day, then paid from credit. Resets at 00:00
              UTC.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function ManageBilling() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => {
        setBusy(true);
        const r = await openBillingPortal();
        setBusy(false);
        if (r.ok) window.location.href = r.url;
        else toast.error(r.message);
      }}
      disabled={busy}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-4 text-[13px] font-medium text-foreground transition hover:bg-surface-2 disabled:opacity-50"
    >
      {busy ? (
        <LoaderCircle className="h-4 w-4 animate-spin" />
      ) : (
        <ExternalLink className="h-4 w-4" />
      )}
      Manage billing
    </button>
  );
}

// ------------------------------------------------------------------ plans

function Plans({
  access,
  billing,
  onAdd,
}: {
  access: Access;
  billing: BillingConfig | null;
  onAdd: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const providers = billing?.providers ?? [];
  const pro = access.plan === "pro";
  const buyPro = async (provider: "stripe" | "paystack") => {
    setBusy(provider);
    const r = await startCheckout({ kind: "pro", provider });
    if (r.ok) window.location.href = r.url;
    else {
      setBusy(null);
      toast.error(r.message);
    }
  };
  const requestPro = async () => {
    setBusy("request");
    const r = await changePlan("request_pro");
    setBusy(null);
    if (r.ok) toast.success("Pro requested. You will hear from us soon.");
    else toast.error(r.message);
  };
  const free = billing?.freeDailyUsd;
  const proFree = billing?.proFreeDailyUsd;
  const margin = billing ? Math.round((billing.markup - 1) * 100) : null;

  const plans = [
    {
      key: "free",
      icon: Sparkles,
      name: "Free",
      price: "$0",
      per: "",
      current: !pro,
      points: [
        "Qwen 3.8 27B, the agent's default",
        free === null || free === undefined
          ? "No daily limit"
          : `${cents(free)} of free use every day`,
        "Projects saved to your account",
        "Your own machine for every project",
      ],
    },
    {
      key: "payg",
      icon: Wallet,
      name: "Pay as you go",
      price: "Credit",
      per: "from $5",
      current: false,
      points: [
        "Claude, GPT and Gemini",
        margin !== null
          ? `Each call at the model's price + ${margin}%`
          : "Each call at the model's price",
        "Credit never expires",
        "Keeps Qwen going past the free allowance",
      ],
    },
    {
      key: "pro",
      icon: Crown,
      name: "Pro",
      price: billing ? `$${billing.proPriceUsd}` : "Pro",
      per: "/ month",
      current: pro,
      points: [
        billing
          ? `${cents(billing.proIncludedUsd)} of credit included every month`
          : "Credit included every month",
        proFree === null || proFree === undefined
          ? "Unlimited free Qwen"
          : `${cents(proFree)} of free Qwen use a day`,
        "Every model, longer runs",
        "Cancel any time",
      ],
    },
  ];

  return (
    <section className="grid gap-3 md:grid-cols-3">
      {plans.map((p) => (
        <div
          key={p.key}
          className={cn(
            "flex flex-col rounded-2xl border bg-surface p-5",
            p.key === "pro" ? "border-primary/50" : "border-border",
          )}
        >
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-2 text-[14px] font-semibold">
              <p.icon
                className={cn(
                  "h-4 w-4",
                  p.key === "pro" ? "text-primary" : "text-muted-foreground",
                )}
              />
              {p.name}
            </p>
            {p.current && (
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                Current
              </span>
            )}
          </div>
          <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight">
            {p.price}
            {p.per && (
              <span className="ml-1 text-[12.5px] font-normal text-muted-foreground">{p.per}</span>
            )}
          </p>
          <ul className="mt-4 flex-1 space-y-2">
            {p.points.map((pt) => (
              <li key={pt} className="flex items-start gap-2 text-[12.5px] text-foreground/90">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                {pt}
              </li>
            ))}
          </ul>
          <div className="mt-5 space-y-2">
            {p.key === "payg" && !access.unlimited && (
              <button
                onClick={onAdd}
                disabled={!providers.length}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[13px] font-medium transition hover:bg-surface-2 disabled:opacity-50"
              >
                <Plus className="h-4 w-4" /> Add credit
              </button>
            )}
            {p.key === "pro" &&
              (access.unlimited ? (
                <p className="text-center text-[12px] text-muted-foreground">
                  Granted by DevStation
                </p>
              ) : pro && access.proUntil ? (
                <p className="text-center text-[12px] text-muted-foreground">
                  {access.subscribed ? "Renews" : "Runs until"}{" "}
                  {new Date(access.proUntil).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              ) : providers.length ? (
                providers.map((provider) => (
                  <button
                    key={provider}
                    onClick={() => void buyPro(provider)}
                    disabled={!!busy}
                    className={cn(
                      "inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium transition disabled:opacity-60",
                      provider === providers[0]
                        ? "bg-primary text-primary-foreground hover:bg-primary-hover"
                        : "border border-border hover:bg-surface-2",
                    )}
                  >
                    {busy === provider ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                    {provider === "stripe" ? "Subscribe with card" : "Pay 30 days with Paystack"}
                  </button>
                ))
              ) : access.proRequested ? (
                <p className="text-center text-[12px] text-muted-foreground">
                  Requested: we will be in touch
                </p>
              ) : (
                <button
                  onClick={() => void requestPro()}
                  disabled={!!busy}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary text-[13px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
                >
                  {busy === "request" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Crown className="h-4 w-4" />
                  )}
                  Request Pro
                </button>
              ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function AddCredit({ billing, onClose }: { billing: BillingConfig; onClose: () => void }) {
  const [amount, setAmount] = useState<number>(billing.topUps[1] ?? billing.topUps[0] ?? 25);
  const [custom, setCustom] = useState("");
  const [provider, setProvider] = useState(billing.providers[0]);
  const [busy, setBusy] = useState(false);
  const value = custom ? Number(custom) : amount;
  const valid =
    Number.isFinite(value) && value >= billing.minTopUpUsd && value <= billing.maxTopUpUsd;
  const pay = async () => {
    if (!valid || !provider) return;
    setBusy(true);
    const r = await startCheckout({ kind: "topup", provider, amount: value });
    if (r.ok) window.location.href = r.url;
    else {
      setBusy(false);
      toast.error(r.message);
    }
  };
  return (
    <Modal title="Add credit" icon={Wallet} onClose={onClose}>
      <p className="text-[12.5px] text-muted-foreground">
        Credit pays for every model call past the free allowance, at the model&apos;s price plus{" "}
        {Math.round((billing.markup - 1) * 100)}%. It never expires.
      </p>
      <div className="mt-4 grid grid-cols-4 gap-2">
        {billing.topUps.map((t) => (
          <button
            key={t}
            onClick={() => {
              setAmount(t);
              setCustom("");
            }}
            className={cn(
              "h-11 rounded-xl border text-[14px] font-semibold tabular-nums transition",
              !custom && amount === t
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-foreground hover:bg-surface-2",
            )}
          >
            ${t}
          </button>
        ))}
      </div>
      <label className="mt-3 flex h-10 items-center gap-2 rounded-xl border border-border px-3 focus-within:border-primary/60">
        <span className="text-[13px] text-muted-foreground">$</span>
        <input
          inputMode="decimal"
          value={custom}
          onChange={(e) => setCustom(e.target.value.replace(/[^0-9.]/g, "").slice(0, 7))}
          placeholder={`Another amount (${billing.minTopUpUsd} to ${billing.maxTopUpUsd})`}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-meta"
        />
      </label>
      {billing.providers.length > 1 && (
        <div className="mt-4 space-y-2">
          <p className="text-[12px] font-medium text-muted-foreground">Pay with</p>
          {billing.providers.map((p) => (
            <button
              key={p}
              onClick={() => setProvider(p)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition",
                provider === p ? "border-primary bg-primary/5" : "border-border hover:bg-surface-2",
              )}
            >
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-[13px] font-medium text-foreground">
                  {PROVIDER_LABEL[p]}
                </span>
                <span className="block text-[11.5px] text-muted-foreground">
                  {PROVIDER_HINT[p]}
                </span>
              </span>
              {provider === p && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
      {provider === "paystack" && billing.paystackCurrency !== "USD" && (
        <p className="mt-2 text-[11.5px] text-meta">
          Charged in {billing.paystackCurrency} at today&apos;s rate.
        </p>
      )}
      <button
        onClick={() => void pay()}
        disabled={!valid || busy}
        className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-[14px] font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
      >
        {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
        {valid ? `Pay ${usd(value)}` : `Enter $${billing.minTopUpUsd} to $${billing.maxTopUpUsd}`}
      </button>
      <p className="mt-2 text-center text-[11px] text-meta">
        Payments are handled by {provider === "paystack" ? "Paystack" : "Stripe"}. DevStation never
        sees your card.
      </p>
    </Modal>
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
      label: "Charged to credit",
      value: usd(t.billed),
      delta: change(t.billed, t.billed_prev),
      invert: true,
      hint: "What your calls were charged",
    },
    {
      label: "Model cost",
      value: usd(t.cost),
      delta: change(t.cost, t.cost_prev),
      invert: true,
      hint: "At the models' own prices, free use included",
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

function Billing({ billed }: { billed: number }) {
  return Number(billed) > 0 ? (
    <span className="whitespace-nowrap rounded-md bg-primary/12 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-primary">
      {usd(billed)}
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
        { label: "Calls", right: true },
        { label: "Input", right: true },
        { label: "Output", right: true },
        { label: "Model cost", right: true },
        { label: "Charged", right: true },
      ]}
    >
      {models.map((m) => (
        <tr key={m.model}>
          <td>
            <ModelCell id={m.model} />
          </td>
          <td className="text-right tabular-nums">{num(m.calls)}</td>
          <td className="text-right tabular-nums">{compact(m.input)}</td>
          <td className="text-right tabular-nums">{compact(m.output)}</td>
          <td className="text-right tabular-nums text-muted-foreground">{usd(m.cost)}</td>
          <td className="text-right">
            <Billing billed={m.billed} />
          </td>
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
        { label: "Charged", right: true },
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
          <td className="text-right">
            <Billing billed={r.billed} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

const LEDGER_LABEL: Record<string, string> = {
  topup: "Credit added",
  pro_included: "Credit included with Pro",
  adjustment: "Adjustment",
  refund: "Refund",
};

function History({ usage }: { usage: Usage }) {
  const items: { at: string; label: string; detail?: string; amount: string }[] = [
    ...usage.credits.map((c) => ({
      at: c.claimed_at,
      label: "Launch credit",
      amount: `+${usd(Number(c.amount_usd))}`,
    })),
    ...usage.ledger.map((l) => ({
      at: l.created_at,
      label: LEDGER_LABEL[l.kind] ?? l.note,
      amount: `${Number(l.amount_usd) >= 0 ? "+" : ""}${usd(Number(l.amount_usd))}`,
    })),
    ...usage.payments.map((p) => ({
      at: p.created_at,
      label: p.kind === "pro" ? "Paid for Pro" : "Paid for credit",
      detail: p.provider === "stripe" ? "Stripe" : "Paystack",
      amount: usd(Number(p.amount_usd)),
    })),
    ...(usage.plan?.pro_requested_at
      ? [{ at: usage.plan.pro_requested_at, label: "Asked for Pro", amount: "" }]
      : []),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <Table
      empty={!items.length}
      head={[{ label: "Date" }, { label: "What" }, { label: "Amount", right: true }]}
    >
      {items.map((it, i) => (
        <tr key={`${it.at}-${it.label}-${i}`}>
          <td className="whitespace-nowrap text-muted-foreground">
            {new Date(it.at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </td>
          <td className="text-foreground">
            {it.label}
            {it.detail && <span className="ml-2 text-[11.5px] text-meta">{it.detail}</span>}
          </td>
          <td
            className={cn(
              "text-right font-medium tabular-nums",
              it.amount.startsWith("+") ? "text-success" : "text-foreground",
            )}
          >
            {it.amount}
          </td>
        </tr>
      ))}
    </Table>
  );
}
