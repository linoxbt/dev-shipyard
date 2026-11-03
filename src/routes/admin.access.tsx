import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, RefreshCw, Search, UserCheck, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { Card, Shell, Unavailable, when } from "@/components/stats/StatsDashboard";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

// Who may use DevStation, for the accounts in ADMIN_EMAILS
// (api/admin/access): open sign-ups up to a limit of your choosing, or close
// them so new accounts wait on a list; let people in from that list, one at a
// time, a few at once or the next in line; and take access away again.

export const Route = createFileRoute("/admin/access")({
  head: () => ({
    meta: [{ title: "Access · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: AccessAdmin,
});

interface Settings {
  open: boolean;
  maxMembers: number | null;
  members: number;
  waiting: number;
  updatedAt: string | null;
}

interface Waiting {
  owner: string;
  email: string;
  joinedAt: string;
  lastSeenAt: string;
  held: boolean;
}

interface Member {
  owner: string;
  email: string | null;
  admittedAt: string;
  via: string;
}

interface Payload {
  settings: Settings;
  waitlist: Waiting[];
  members: Member[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithGrant(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message || "That did not work just now.");
  return body as T;
}

const post = <T,>(body: Record<string, unknown>) =>
  call<T>("/api/admin/access", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const VIA: Record<string, string> = {
  grandfathered: "Before the limit",
  open: "Joined",
  admin: "Let in",
};

function AccessAdmin() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const authReady = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  useEffect(() => useAuth.getState().init(), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await call<Payload>("/api/admin/access"));
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

  const act = async (key: string, body: Record<string, unknown>, done: (r: never) => string) => {
    setBusy(key);
    try {
      const r = await post<never>(body);
      toast.success(done(r));
      await load();
      return true;
    } catch (e) {
      toast.error((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell
      label="Access"
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
        <Unavailable title="Access settings are not available" message={error} />
      ) : !data ? (
        <div className="space-y-4">
          <div className="ds-skeleton h-40 rounded-2xl" />
          <div className="ds-skeleton h-64 rounded-2xl" />
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-[22.5px] font-semibold tracking-tight">Access</h1>
            <p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
              Decide how many people can use DevStation. While sign-ups are open, new accounts get
              in until the limit is reached; after that, or while sign-ups are closed, they join the
              waitlist and you let them in from here.
            </p>
          </div>
          <SignupsCard
            settings={data.settings}
            busy={busy === "set"}
            onSave={(patch) =>
              act("set", { action: "set", ...patch }, () => "Sign-up settings saved.")
            }
          />
          <WaitlistCard
            rows={data.waitlist}
            busy={busy}
            onGrant={(owners, key) =>
              act(key, { action: "grant", owners }, (r: { granted: number }) =>
                r.granted === 1 ? "1 person let in." : `${r.granted} people let in.`,
              )
            }
            onGrantNext={(n) =>
              act("next", { action: "grant_next", n }, (r: { granted: number }) =>
                r.granted === 1 ? "1 person let in." : `${r.granted} people let in.`,
              )
            }
          />
          <MembersCard
            rows={data.members}
            total={data.settings.members}
            busy={busy}
            onRevoke={(m) =>
              act(
                `r:${m.owner}`,
                { action: "revoke", owner: m.owner },
                () => `${m.email ?? "That account"} is back on the waitlist.`,
              )
            }
          />
        </div>
      )}
    </Shell>
  );
}

function SignupsCard({
  settings,
  busy,
  onSave,
}: {
  settings: Settings;
  busy: boolean;
  onSave: (patch: { open: boolean; maxMembers: number | null }) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(settings.open);
  const [limited, setLimited] = useState(settings.maxMembers !== null);
  const [limit, setLimit] = useState(
    String(settings.maxMembers ?? Math.max(settings.members, 100)),
  );
  useEffect(() => {
    setOpen(settings.open);
    setLimited(settings.maxMembers !== null);
    setLimit(String(settings.maxMembers ?? Math.max(settings.members, 100)));
  }, [settings]);

  const max = limited ? Math.max(0, Math.floor(Number(limit) || 0)) : null;
  const changed = open !== settings.open || max !== settings.maxMembers;
  const left =
    settings.maxMembers === null ? null : Math.max(0, settings.maxMembers - settings.members);
  const share =
    settings.maxMembers && settings.maxMembers > 0
      ? Math.min(1, settings.members / settings.maxMembers)
      : null;

  const state = !settings.open
    ? "Closed: every new account joins the waitlist."
    : settings.maxMembers === null
      ? "Open to everyone, with no limit."
      : left === 0
        ? `Open, but full: all ${settings.maxMembers.toLocaleString()} places are taken, so new accounts join the waitlist.`
        : `Open: ${left!.toLocaleString()} of ${settings.maxMembers.toLocaleString()} places left.`;

  return (
    <Card title="Sign-ups" note={state}>
      <div className="grid gap-6 md:grid-cols-[1fr_1fr]">
        <div className="space-y-5">
          <div>
            <p className="text-[13.5px] font-medium">New accounts</p>
            <div className="mt-2 inline-flex rounded-xl border border-border p-1">
              {[
                { v: true, label: "Open" },
                { v: false, label: "Closed (waitlist)" },
              ].map((o) => (
                <button
                  key={o.label}
                  onClick={() => setOpen(o.v)}
                  className={cn(
                    "rounded-lg px-3.5 py-1.5 text-[13.5px] transition",
                    open === o.v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[13.5px] font-medium">How many people can have access</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={!limited}
                  onChange={(e) => setLimited(!e.target.checked)}
                  className="h-4 w-4 accent-[var(--primary)]"
                />
                No limit
              </label>
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={limit}
                disabled={!limited}
                onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
                aria-label="Limit"
                className="h-9 w-32 rounded-lg border border-border bg-background px-3 text-[14px] tabular-nums outline-none focus:border-primary disabled:opacity-50"
              />
              <span className="text-[13px] text-muted-foreground">people</span>
            </div>
            {limited && max !== null && max < settings.members && (
              <p className="mt-2 text-[12.5px] text-warning">
                {settings.members.toLocaleString()} people already have access. Nobody loses it; new
                accounts wait until the count drops below {max.toLocaleString()}.
              </p>
            )}
          </div>
          <button
            onClick={() => void onSave({ open, maxMembers: max })}
            disabled={!changed || busy}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />} Save
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 self-start">
          <Figure label="Have access" value={settings.members.toLocaleString()}>
            {share !== null && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn("h-full rounded-full", share >= 1 ? "bg-warning" : "bg-primary")}
                  style={{ width: `${share * 100}%` }}
                />
              </div>
            )}
            <p className="mt-1.5 text-[12px] text-meta">
              {settings.maxMembers === null
                ? "No limit"
                : `of ${settings.maxMembers.toLocaleString()}`}
            </p>
          </Figure>
          <Figure label="Waiting" value={settings.waiting.toLocaleString()}>
            <p className="mt-1.5 text-[12px] text-meta">on the waitlist</p>
          </Figure>
        </div>
      </div>
    </Card>
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
    <div className="rounded-xl border border-border bg-background px-4 py-3">
      <p className="text-[12.5px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-[24.5px] font-semibold tabular-nums">{value}</p>
      {children}
    </div>
  );
}

function WaitlistCard({
  rows,
  busy,
  onGrant,
  onGrantNext,
}: {
  rows: Waiting[];
  busy: string | null;
  onGrant: (owners: string[], key: string) => Promise<boolean>;
  onGrantNext: (n: number) => Promise<boolean>;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [next, setNext] = useState("10");
  useEffect(() => setPicked(new Set()), [rows]);
  const toggle = (owner: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(owner)) n.delete(owner);
      else n.add(owner);
      return n;
    });

  return (
    <Card
      title={`Waitlist${rows.length ? ` (${rows.length.toLocaleString()})` : ""}`}
      note="Oldest first. Letting someone in works past the limit: it is your choice."
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-[13.5px] text-muted-foreground">Nobody is waiting.</p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[13.5px]">Let in the next</span>
            <input
              value={next}
              onChange={(e) => setNext(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              inputMode="numeric"
              aria-label="How many to let in"
              className="h-8 w-16 rounded-lg border border-border bg-background px-2 text-center text-[13.5px] tabular-nums outline-none focus:border-primary"
            />
            <button
              onClick={() => void onGrantNext(Math.max(1, Number(next) || 1))}
              disabled={!!busy}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {busy === "next" ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Users className="h-3.5 w-3.5" />
              )}
              Let in
            </button>
            {picked.size > 0 && (
              <button
                onClick={() => void onGrant([...picked], "picked")}
                disabled={!!busy}
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium hover:bg-surface-2 disabled:opacity-50"
              >
                {busy === "picked" && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                Let in {picked.size} selected
              </button>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-left text-[13.5px]">
              <thead className="bg-surface-2/60 text-[12px] text-muted-foreground">
                <tr>
                  <th className="w-8 px-3 py-2" />
                  <th className="px-3 py-2 font-medium">#</th>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Joined</th>
                  <th className="px-3 py-2 font-medium">Last tried</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((w, i) => (
                  <tr key={w.owner}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={picked.has(w.owner)}
                        onChange={() => toggle(w.owner)}
                        aria-label={`Select ${w.email}`}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                    </td>
                    <td className="px-3 py-2 tabular-nums text-meta">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className="break-all">{w.email || "Unknown"}</span>
                      {w.held && (
                        <span className="ml-2 rounded-md bg-warning/10 px-1.5 py-0.5 text-[11.5px] text-warning">
                          Access removed
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {when(w.joinedAt)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {when(w.lastSeenAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => void onGrant([w.owner], `g:${w.owner}`)}
                        disabled={!!busy}
                        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12.5px] font-medium hover:bg-surface-2 disabled:opacity-50"
                      >
                        {busy === `g:${w.owner}` ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <UserCheck className="h-3 w-3" />
                        )}
                        Let in
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

function MembersCard({
  rows,
  total,
  busy,
  onRevoke,
}: {
  rows: Member[];
  total: number;
  busy: string | null;
  onRevoke: (m: Member) => Promise<boolean>;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((m) => (m.email ?? "").toLowerCase().includes(t)) : rows;
  }, [rows, q]);
  return (
    <Card
      title={`People with access (${total.toLocaleString()})`}
      note={
        total > rows.length
          ? `The ${rows.length.toLocaleString()} let in most recently`
          : "Most recent first"
      }
    >
      <label className="relative mb-3 block max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by email"
          className="h-9 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-[13.5px] outline-none focus:border-primary"
        />
      </label>
      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-[13.5px]">
          <thead className="bg-surface-2/60 text-[12px] text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">How</th>
              <th className="px-3 py-2 font-medium">Since</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {shown.map((m) => (
              <tr key={m.owner}>
                <td className="px-3 py-2">
                  <span className="break-all">
                    {m.email ?? (
                      <span className="text-meta">Signed up before emails were kept</span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {VIA[m.via] ?? m.via}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {when(m.admittedAt)}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Take access away from ${m.email ?? "this account"}? They go back on the waitlist, and their projects stay as they are.`,
                        )
                      )
                        return;
                      void onRevoke(m);
                    }}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12.5px] text-muted-foreground hover:bg-surface-2 hover:text-danger disabled:opacity-50"
                  >
                    {busy === `r:${m.owner}` ? (
                      <LoaderCircle className="h-3 w-3 animate-spin" />
                    ) : (
                      <UserMinus className="h-3 w-3" />
                    )}
                    Remove
                  </button>
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  {q ? "No one with that email." : "Nobody yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
