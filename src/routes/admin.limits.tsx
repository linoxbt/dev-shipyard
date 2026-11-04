import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Gauge, LoaderCircle, Pencil, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Card, Shell, Unavailable, when } from "@/components/stats/StatsDashboard";
import { Modal } from "@/components/coding-agent/primitives";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// Credit and usage limits, for the accounts in ADMIN_EMAILS
// (api/admin/limits): how much launch credit new accounts get and how many
// get it, whether the free model has a free daily allowance, and how much
// one run, one day and how many runs a day may use on the free plan. Any of
// it can be set for one account instead, credit added to it, or its use
// paused. The model proxy enforces all of it on every call.

export const Route = createFileRoute("/admin/limits")({
  head: () => ({
    meta: [{ title: "Credit and limits · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: LimitsAdmin,
});

interface Settings {
  launchCreditUsd: number;
  launchSlots: number | null;
  freeDailyUsd: number;
  runLimitUsd: number | null;
  dailyLimitUsd: number | null;
  runsPerDay: number | null;
  updatedAt: string | null;
}

interface OwnLimits {
  runLimitUsd: number | null;
  dailyLimitUsd: number | null;
  runsPerDay: number | null;
  freeDailyUsd: number | null;
  noRunLimit: boolean;
  noDailyLimit: boolean;
  noRunsLimit: boolean;
  paused: boolean;
  note: string;
}

interface Account {
  owner: string;
  email: string | null;
  plan: "free" | "pro";
  unlimited: boolean;
  credit: number;
  spent: number;
  balance: number;
  todaySpent: number;
  runsToday: number;
  lastUsed: string | null;
  limits: OwnLimits | null;
}

interface Payload {
  settings: Settings;
  accounts: Account[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithGrant(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "That did not work just now.");
  return body as T;
}

const post = (body: Record<string, unknown>) =>
  call<Payload>("/api/admin/limits", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const usd = (n: number) => `$${n.toFixed(2)}`;
const limitText = (n: number | null, kind: "usd" | "count") =>
  n === null ? "No limit" : kind === "usd" ? usd(n) : String(n);

/** A number typed in a field: null when empty, NaN when not a number. */
const parse = (s: string): number | null => (s.trim() === "" ? null : Number(s));

function LimitsAdmin() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Account | null>(null);

  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => useAuth.getState().init(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call<Payload>("/api/admin/limits"));
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
    void load();
  }, [authReady, signedIn, load]);

  const act = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    try {
      const next = await post(body);
      setData(next);
      toast.success(done);
      return next;
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell
      label="Credit and limits"
      controls={
        <button
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh"
          className="grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-60"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      }
    >
      {error && !data ? (
        <Unavailable title="Limits are not available" message={error} signIn />
      ) : !data ? (
        <div className="space-y-4">
          <div className="ds-skeleton h-72 rounded-2xl" />
          <div className="ds-skeleton h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-[22.5px] font-semibold tracking-tight">Credit and limits</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
              What new accounts get, and how fast they may spend it. Every model call is checked
              against these limits before it runs, so a run, a day or an account stops exactly where
              you set it. Pro and admin-granted accounts follow only the limits you set for them by
              name.
            </p>
          </div>
          <SettingsCard
            settings={data.settings}
            claimed={data.accounts.filter((a) => a.credit > 0).length}
            busy={busy === "settings"}
            onSave={(patch) => act("settings", { action: "settings", ...patch }, "Limits saved.")}
          />
          <AccountsCard accounts={data.accounts} settings={data.settings} onEdit={setEditing} />
        </div>
      )}
      {editing && data && (
        <EditAccount
          account={data.accounts.find((a) => a.owner === editing.owner) ?? editing}
          settings={data.settings}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (limits) => {
            const r = await act(
              "account",
              { action: "account", owner: editing.owner, ...limits },
              "Limits saved for this account.",
            );
            if (r) setEditing(null);
          }}
          onClear={async () => {
            const r = await act(
              "clear",
              { action: "clear", owner: editing.owner },
              "This account follows the defaults again.",
            );
            if (r) setEditing(null);
          }}
          onCredit={(amountUsd, note) =>
            act(
              "credit",
              { action: "credit", owner: editing.owner, amountUsd, note },
              amountUsd > 0 ? `${usd(amountUsd)} added.` : `${usd(-amountUsd)} taken away.`,
            ).then(Boolean)
          }
        />
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------- settings

function Field({
  label,
  hint,
  value,
  onChange,
  prefix,
  placeholder,
  invalid,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[13.5px] font-medium text-foreground">{label}</span>
      <span
        className={cn(
          "mt-1.5 flex h-10 items-center rounded-lg border bg-background px-3 focus-within:border-primary/60",
          invalid ? "border-danger" : "border-border",
        )}
      >
        {prefix && <span className="mr-1 text-[14px] text-meta">{prefix}</span>}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[14px] tabular-nums outline-none placeholder:text-meta"
        />
      </span>
      <span className="mt-1 block text-[12px] leading-5 text-meta">{hint}</span>
    </label>
  );
}

const asText = (n: number | null) => (n === null ? "" : String(n));

function SettingsCard({
  settings,
  claimed,
  busy,
  onSave,
}: {
  settings: Settings;
  claimed: number;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => Promise<unknown>;
}) {
  const [launch, setLaunch] = useState(String(settings.launchCreditUsd));
  const [slots, setSlots] = useState(asText(settings.launchSlots));
  const [free, setFree] = useState(String(settings.freeDailyUsd));
  const [run, setRun] = useState(asText(settings.runLimitUsd));
  const [day, setDay] = useState(asText(settings.dailyLimitUsd));
  const [runs, setRuns] = useState(asText(settings.runsPerDay));
  useEffect(() => {
    setLaunch(String(settings.launchCreditUsd));
    setSlots(asText(settings.launchSlots));
    setFree(String(settings.freeDailyUsd));
    setRun(asText(settings.runLimitUsd));
    setDay(asText(settings.dailyLimitUsd));
    setRuns(asText(settings.runsPerDay));
  }, [settings]);

  const v = {
    launch: parse(launch) ?? 0,
    slots: parse(slots),
    free: parse(free) ?? 0,
    run: parse(run),
    day: parse(day),
    runs: parse(runs),
  };
  const bad = {
    launch: !Number.isFinite(v.launch) || v.launch < 0,
    slots: v.slots !== null && (!Number.isInteger(v.slots) || v.slots < 0),
    free: !Number.isFinite(v.free) || v.free < 0,
    run: v.run !== null && (!Number.isFinite(v.run) || v.run <= 0),
    day: v.day !== null && (!Number.isFinite(v.day) || v.day <= 0),
    runs: v.runs !== null && (!Number.isInteger(v.runs) || v.runs < 1),
  };
  const invalid = Object.values(bad).some(Boolean);
  const runsInCredit = v.run && v.launch > 0 ? Math.max(1, Math.floor(v.launch / v.run)) : null;

  return (
    <Card
      title="For everyone on the free plan"
      note={settings.updatedAt ? `Saved ${when(settings.updatedAt)}` : undefined}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Launch credit"
          prefix="$"
          value={launch}
          onChange={setLaunch}
          invalid={bad.launch}
          hint="Credit each new account can claim once, for any model. 0 offers none."
        />
        <Field
          label="Accounts that get it"
          value={slots}
          onChange={setSlots}
          placeholder="Every account"
          invalid={bad.slots}
          hint={`${claimed} claimed so far. Leave empty for every account.`}
        />
        <Field
          label="Each run"
          prefix="$"
          value={run}
          onChange={setRun}
          placeholder="No limit"
          invalid={bad.run}
          hint="The most one run (the work one message starts) may use. It stops there and the person sends another message to go on."
        />
        <Field
          label="Each day"
          prefix="$"
          value={day}
          onChange={setDay}
          placeholder="No limit"
          invalid={bad.day}
          hint="The most an account may use in a day (UTC). Set it to the launch credit to let it all be used in one day."
        />
        <Field
          label="Runs a day"
          value={runs}
          onChange={setRuns}
          placeholder="No limit"
          invalid={bad.runs}
          hint="How many runs an account may start in a day."
        />
        <Field
          label="Free Qwen a day"
          prefix="$"
          value={free}
          onChange={setFree}
          invalid={bad.free}
          hint="Qwen use that costs the account nothing each day. 0: every run is paid from credit, so the launch credit is what they get."
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-[12.5px] text-muted-foreground">
          {v.launch > 0
            ? `New accounts get ${usd(v.launch)}${
                runsInCredit
                  ? `, about ${runsInCredit} full run${runsInCredit === 1 ? "" : "s"}`
                  : ""
              }${v.day ? `, at most ${usd(v.day)} a day` : ""}.`
            : "New accounts get no launch credit."}
        </p>
        <button
          onClick={() =>
            void onSave({
              launchCreditUsd: v.launch,
              launchSlots: v.slots,
              freeDailyUsd: v.free,
              runLimitUsd: v.run,
              dailyLimitUsd: v.day,
              runsPerDay: v.runs,
            })
          }
          disabled={busy || invalid}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
        >
          {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
          Save limits
        </button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- accounts

/** The limits an account is held to, as the proxy works them out. */
function held(a: Account, s: Settings) {
  const own = a.limits;
  const free = a.plan === "free";
  const pick = (mine: number | null | undefined, off: boolean | undefined, d: number | null) =>
    off ? null : (mine ?? (free ? d : null));
  return {
    run: pick(own?.runLimitUsd, own?.noRunLimit, s.runLimitUsd),
    day: pick(own?.dailyLimitUsd, own?.noDailyLimit, s.dailyLimitUsd),
    runs: pick(own?.runsPerDay, own?.noRunsLimit, s.runsPerDay),
    paused: !!own?.paused,
  };
}

function AccountsCard({
  accounts,
  settings,
  onEdit,
}: {
  accounts: Account[];
  settings: Settings;
  onEdit: (a: Account) => void;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle
      ? accounts.filter((a) => (a.email ?? a.owner).toLowerCase().includes(needle))
      : accounts;
  }, [accounts, q]);
  return (
    <Card
      title="Accounts"
      note={
        <label className="flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5">
          <Search className="h-3.5 w-3.5 text-meta" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Find an email"
            className="w-40 bg-transparent text-[13px] outline-none placeholder:text-meta"
          />
        </label>
      }
    >
      {shown.length === 0 ? (
        <p className="py-10 text-center text-[13.5px] text-muted-foreground">No accounts match.</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[720px] text-[13.5px]">
            <thead>
              <tr className="border-b border-border text-left text-[12px] text-meta">
                <th className="px-2 py-2 font-medium">Account</th>
                <th className="px-2 py-2 font-medium">Credit left</th>
                <th className="px-2 py-2 font-medium">Today</th>
                <th className="px-2 py-2 font-medium">Limits</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((a) => {
                const h = held(a, settings);
                return (
                  <tr key={a.owner} className="align-top">
                    <td className="px-2 py-2.5">
                      <p className="font-medium text-foreground">
                        {a.email ?? a.owner.slice(0, 10)}
                      </p>
                      <p className="text-[12px] text-meta">
                        {a.unlimited ? "Unlimited (admin)" : a.plan === "pro" ? "Pro" : "Free"}
                        {a.lastUsed ? ` · used ${when(a.lastUsed)}` : " · not used yet"}
                      </p>
                    </td>
                    <td className="px-2 py-2.5 tabular-nums">
                      {a.unlimited ? "Unlimited" : usd(a.balance)}
                      <p className="text-[12px] text-meta">
                        {usd(a.spent)} of {usd(a.credit)} used
                      </p>
                    </td>
                    <td className="px-2 py-2.5 tabular-nums">
                      {usd(a.todaySpent)}
                      <p className="text-[12px] text-meta">
                        {a.runsToday} run{a.runsToday === 1 ? "" : "s"}
                      </p>
                    </td>
                    <td className="px-2 py-2.5 text-[12.5px]">
                      {h.paused ? (
                        <span className="rounded-md bg-danger/10 px-1.5 py-0.5 font-medium text-danger">
                          Paused
                        </span>
                      ) : (
                        <span className="text-muted-foreground">
                          {limitText(h.run, "usd")} a run · {limitText(h.day, "usd")} a day ·{" "}
                          {limitText(h.runs, "count")} runs
                        </span>
                      )}
                      {a.limits && (
                        <span className="ml-1.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[11.5px] font-medium text-primary">
                          Own limits
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        onClick={() => onEdit(a)}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[13px] text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- one account

type Mode = "default" | "none" | "custom";

function LimitRow({
  label,
  mode,
  setMode,
  value,
  setValue,
  fallback,
  prefix,
  allowNone = true,
}: {
  label: string;
  mode: Mode;
  setMode: (m: Mode) => void;
  value: string;
  setValue: (v: string) => void;
  fallback: string;
  prefix?: string;
  allowNone?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      <span className="w-32 text-[13.5px] text-foreground">{label}</span>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
        className="h-9 rounded-lg border border-border bg-background px-2 text-[13px]"
      >
        <option value="default">Default ({fallback})</option>
        {allowNone && <option value="none">No limit</option>}
        <option value="custom">Set for this account</option>
      </select>
      {mode === "custom" && (
        <span className="flex h-9 w-28 items-center rounded-lg border border-border bg-background px-2">
          {prefix && <span className="mr-1 text-meta">{prefix}</span>}
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="decimal"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] tabular-nums outline-none"
            autoFocus
          />
        </span>
      )}
    </div>
  );
}

function EditAccount({
  account,
  settings,
  busy,
  onClose,
  onSave,
  onClear,
  onCredit,
}: {
  account: Account;
  settings: Settings;
  busy: string | null;
  onClose: () => void;
  onSave: (l: OwnLimits) => Promise<void>;
  onClear: () => Promise<void>;
  onCredit: (amountUsd: number, note: string) => Promise<boolean>;
}) {
  const own = account.limits;
  const modeOf = (v: number | null | undefined, off: boolean | undefined): Mode =>
    off ? "none" : v != null ? "custom" : "default";
  const [runMode, setRunMode] = useState<Mode>(modeOf(own?.runLimitUsd, own?.noRunLimit));
  const [run, setRun] = useState(asText(own?.runLimitUsd ?? settings.runLimitUsd));
  const [dayMode, setDayMode] = useState<Mode>(modeOf(own?.dailyLimitUsd, own?.noDailyLimit));
  const [day, setDay] = useState(asText(own?.dailyLimitUsd ?? settings.dailyLimitUsd));
  const [runsMode, setRunsMode] = useState<Mode>(modeOf(own?.runsPerDay, own?.noRunsLimit));
  const [runs, setRuns] = useState(asText(own?.runsPerDay ?? settings.runsPerDay));
  const [freeMode, setFreeMode] = useState<Mode>(modeOf(own?.freeDailyUsd, false));
  const [free, setFree] = useState(asText(own?.freeDailyUsd ?? settings.freeDailyUsd));
  const [paused, setPaused] = useState(!!own?.paused);
  const [note, setNote] = useState(own?.note ?? "");
  const [amount, setAmount] = useState("5");
  const [creditNote, setCreditNote] = useState("");

  const free_ = account.plan === "free";
  const d = (n: number | null, kind: "usd" | "count") => (free_ ? limitText(n, kind) : "No limit");

  const value = (mode: Mode, s: string, integer = false) => {
    if (mode !== "custom") return { ok: true, n: null as number | null };
    const n = parse(s);
    const ok = n !== null && Number.isFinite(n) && n > 0 && (!integer || Number.isInteger(n));
    return { ok, n };
  };
  const r = value(runMode, run);
  const dd = value(dayMode, day);
  const rr = value(runsMode, runs, true);
  const fParsed = freeMode === "custom" ? parse(free) : null;
  const fOk =
    freeMode !== "custom" || (fParsed !== null && Number.isFinite(fParsed) && fParsed >= 0);
  const valid = r.ok && dd.ok && rr.ok && fOk;
  const amountN = parse(amount);
  const amountOk = amountN !== null && Number.isFinite(amountN) && amountN !== 0;

  return (
    <Modal title={account.email ?? account.owner} icon={Gauge} onClose={onClose} wide>
      <div className="space-y-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Credit left", account.unlimited ? "Unlimited" : usd(account.balance)],
            ["Used today", usd(account.todaySpent)],
            ["Runs today", String(account.runsToday)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-surface-2/60 px-2 py-2.5">
              <p className="text-[11.5px] text-meta">{k}</p>
              <p className="mt-0.5 text-[16px] font-semibold tabular-nums">{v}</p>
            </div>
          ))}
        </div>

        <div>
          <p className="text-[13.5px] font-medium">Limits</p>
          {!free_ && (
            <p className="mt-0.5 text-[12.5px] text-meta">
              This account is on {account.unlimited ? "admin-granted Pro" : "Pro"}: the defaults do
              not apply, only what you set here.
            </p>
          )}
          <div className="mt-1 divide-y divide-border">
            <LimitRow
              label="Each run"
              mode={runMode}
              setMode={setRunMode}
              value={run}
              setValue={setRun}
              fallback={d(settings.runLimitUsd, "usd")}
              prefix="$"
            />
            <LimitRow
              label="Each day"
              mode={dayMode}
              setMode={setDayMode}
              value={day}
              setValue={setDay}
              fallback={d(settings.dailyLimitUsd, "usd")}
              prefix="$"
            />
            <LimitRow
              label="Runs a day"
              mode={runsMode}
              setMode={setRunsMode}
              value={runs}
              setValue={setRuns}
              fallback={d(settings.runsPerDay, "count")}
            />
            <LimitRow
              label="Free Qwen a day"
              mode={freeMode}
              setMode={setFreeMode}
              value={free}
              setValue={setFree}
              fallback={free_ ? usd(settings.freeDailyUsd) : "Pro allowance"}
              prefix="$"
              allowNone={false}
            />
          </div>
          <label className="mt-3 flex items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={paused}
              onChange={(e) => setPaused(e.target.checked)}
              className="h-4 w-4 accent-[var(--primary)]"
            />
            Pause this account's model use
          </label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note for the admins (optional)"
            maxLength={500}
            className="mt-3 h-9 w-full rounded-lg border border-border bg-background px-3 text-[13.5px] outline-none placeholder:text-meta"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() =>
                void onSave({
                  runLimitUsd: r.n,
                  dailyLimitUsd: dd.n,
                  runsPerDay: rr.n,
                  freeDailyUsd: freeMode === "custom" ? fParsed : null,
                  noRunLimit: runMode === "none",
                  noDailyLimit: dayMode === "none",
                  noRunsLimit: runsMode === "none",
                  paused,
                  note,
                })
              }
              disabled={!!busy || !valid}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
            >
              {busy === "account" && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Save limits
            </button>
            {own && (
              <button
                onClick={() => void onClear()}
                disabled={!!busy}
                className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[13.5px] text-muted-foreground hover:text-foreground disabled:opacity-60"
              >
                Use the defaults
              </button>
            )}
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="text-[13.5px] font-medium">Add credit</p>
          <p className="mt-0.5 text-[12.5px] text-meta">
            Added to this account's balance at once. A negative amount takes credit away.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="flex h-9 w-28 items-center rounded-lg border border-border bg-background px-2">
              <span className="mr-1 text-meta">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="min-w-0 flex-1 bg-transparent text-[13.5px] tabular-nums outline-none"
              />
            </span>
            <input
              value={creditNote}
              onChange={(e) => setCreditNote(e.target.value)}
              placeholder="Why (optional)"
              maxLength={200}
              className="h-9 min-w-[160px] flex-1 rounded-lg border border-border bg-background px-3 text-[13.5px] outline-none placeholder:text-meta"
            />
            <button
              onClick={async () => {
                if (amountN !== null && (await onCredit(amountN, creditNote))) setCreditNote("");
              }}
              disabled={!!busy || !amountOk}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-[13.5px] font-medium text-foreground hover:bg-surface-2 disabled:opacity-60"
            >
              {busy === "credit" && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {amountN !== null && amountN < 0 ? "Take away" : "Add credit"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
