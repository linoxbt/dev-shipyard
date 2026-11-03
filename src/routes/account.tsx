import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  LayoutTemplate,
  MessageSquareHeart,
  Users,
  BarChart3,
  BookOpen,
  ChevronRight,
  Cookie,
  Crown,
  LifeBuoy,
  LoaderCircle,
  LogOut,
  Moon,
  Plug,
  Sun,
  Terminal,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell, pageHref } from "@/components/coding-agent/PageShell";
import { Segmented } from "@/components/coding-agent/primitives";
import { AuthSheet } from "@/components/coding-agent/AuthSheet";
import { initials, useAuth } from "@/hooks/useAuth";
import { fetchAccess, type Access } from "@/lib/coding-agent/account-client";
import { useConsent } from "@/lib/consent";
import { docsHref } from "@/lib/site-hosts";
import { useTheme } from "@/lib/theme";
import { useProjects } from "@/lib/appgen/projects";

// The account, as a page: who you are, your plan and credit, connected
// accounts, appearance and privacy, help, and signing out.

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [{ title: "Account · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: AccountPage,
});

function AccountPage() {
  const ready = useAuth((s) => s.ready);
  const account = useAuth((s) => s.account);
  const updateProfile = useAuth((s) => s.updateProfile);
  const signOut = useAuth((s) => s.signOut);
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const manageCookies = useConsent((s) => s.manage);
  const projects = useProjects((s) => s.projects);
  const [access, setAccess] = useState<Access | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    useAuth.getState().init();
    void useProjects.getState().hydrate();
  }, []);
  useEffect(() => setName(account?.name ?? ""), [account?.name]);
  useEffect(() => {
    if (account) void fetchAccess().then(setAccess);
  }, [account]);

  const saveName = async () => {
    setSaving(true);
    const problem = await updateProfile({ name: name.trim() });
    setSaving(false);
    if (problem) toast.error(problem);
    else toast.success("Saved.");
  };

  const plan =
    access?.plan === "pro"
      ? "Pro"
      : access && access.claimed > 0
        ? `$${access.balance.toFixed(2)} credit`
        : "Free";

  return (
    <PageShell title="Account" description="Your profile, plan and settings.">
      {!ready ? (
        <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading
        </p>
      ) : !account ? (
        <div className="rounded-2xl border border-border bg-surface p-6 text-center">
          <p className="text-[14.5px] font-medium">You are not signed in</p>
          <p className="mt-1 text-[13.5px] text-muted-foreground">
            Sign in with your email to keep projects on every device.
          </p>
          <button
            onClick={() => setSigningIn(true)}
            className="mt-4 rounded-lg bg-primary px-4 py-2 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Sign in or create an account
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-surface-2 text-[17.5px] font-semibold text-foreground/85">
                {initials(account)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[16.5px] font-semibold">
                  {account.name ?? account.email.split("@")[0]}
                </p>
                <p className="truncate text-[13.5px] text-muted-foreground">{account.email}</p>
                <p className="mt-0.5 text-[12.5px] text-meta">
                  {projects.length} project{projects.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void saveName();
              }}
              className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-end"
            >
              <label className="flex-1">
                <span className="text-[12.5px] font-medium text-muted-foreground">Your name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="What should we call you?"
                  className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-[14px] outline-none focus:border-primary/60"
                />
              </label>
              <button
                type="submit"
                disabled={saving || !name.trim() || name.trim() === (account.name ?? "")}
                className="h-10 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </form>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <Row
              icon={Crown}
              href={pageHref("/credits")}
              label="Plan, credits and usage"
              detail={plan}
            />
            <Row icon={Plug} href={pageHref("/connections")} label="Connected accounts" />
            {access?.admin && (
              <>
                <Row icon={BarChart3} href={pageHref("/admin/stats")} label="DevStation stats" />
                <Row
                  icon={LayoutTemplate}
                  href={pageHref("/admin/templates")}
                  label="Community templates"
                />
                <Row icon={Users} href={pageHref("/admin/access")} label="Access and waitlist" />
                <Row
                  icon={MessageSquareHeart}
                  href={pageHref("/admin/feedback")}
                  label="Feedback"
                />
              </>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5">
            <p className="text-[14.5px] font-medium">Appearance</p>
            <div className="mt-3">
              <Segmented
                value={theme}
                onChange={(t) => {
                  setTheme(t);
                  void updateProfile({ theme: t });
                }}
                options={[
                  { value: "light", label: "Light", icon: Sun },
                  { value: "dark", label: "Dark", icon: Moon },
                ]}
              />
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-border bg-surface">
            <Row icon={Cookie} onClick={() => manageCookies(true)} label="Cookie preferences" />
            <Row icon={LifeBuoy} href={docsHref("/docs/coding-agent")} label="Help" />
            <Row
              icon={BookOpen}
              href={docsHref("/docs/coding-agent")}
              label="How the agent works"
            />
            <Row icon={Terminal} href={docsHref("/docs/cli/install")} label="DevStation CLI" />
          </section>

          <button
            onClick={() => {
              void signOut().then(() => window.location.assign("/"));
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13.5px] text-muted-foreground transition hover:border-danger/50 hover:text-danger"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
      {signingIn && <AuthSheet onClose={() => setSigningIn(false)} />}
    </PageShell>
  );
}

function Row({
  icon: Icon,
  label,
  detail,
  href,
  onClick,
}: {
  icon: typeof Crown;
  label: string;
  detail?: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 text-[14.5px] text-foreground">{label}</span>
      {detail && <span className="text-[13px] text-muted-foreground">{detail}</span>}
      <ChevronRight className="h-4 w-4 text-meta" />
    </>
  );
  const cls =
    "flex w-full items-center gap-3 border-b border-border px-5 py-3.5 text-left transition last:border-b-0 hover:bg-surface-2";
  return href ? (
    <a href={href} className={cls}>
      {body}
    </a>
  ) : (
    <button onClick={onClick} className={cls}>
      {body}
    </button>
  );
}
