import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  LoaderCircle,
  RefreshCw,
  Rocket,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { PageShell, pageHref } from "@/components/coding-agent/PageShell";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/lib/appgen/projects";
import { cn } from "@/lib/utils";

// Publishing, as a page: put a project's build live at
// <name>.devstation.online, publish it again after changes, point a domain of
// one's own at it, or take it down. The agent can still deploy to the
// person's own Netlify or Vercel instead.

export const Route = createFileRoute("/publish")({
  head: () => ({
    meta: [{ title: "Publish · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: PublishPage,
});

interface SiteView {
  id: string;
  slug: string;
  name: string;
  url: string;
  files: number;
  bytes: number;
  customDomain: string | null;
  domainVerified: boolean;
  deployedAt: string | null;
}

interface DomainStatus {
  domain: string;
  verified: boolean;
  configured: boolean;
  owned?: boolean;
  records: { type: string; name: string; value: string }[];
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return s.length >= 3 ? s : `${s || "my"}-app`;
}

async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  try {
    const res = await fetchWithGrant(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as T & { message?: string };
    return res.ok
      ? { ok: true, data: body }
      : { ok: false, message: body.message || "That did not work." };
  } catch {
    return { ok: false, message: "DevStation could not be reached. Check your connection." };
  }
}

/** Whether the address opens the app (api/sites "reach"). */
interface Reach {
  host: string;
  ok: boolean;
  stage: "dns" | "elsewhere" | "tls" | "http" | "stale" | "live";
  message: string;
  checkedAt: string;
}

/** Stages that sort themselves out in a few minutes, worth checking again. */
const SETTLING = new Set<Reach["stage"]>(["stale", "http", "tls"]);
const RECHECK_MS = 10_000;
const RECHECKS = 18;

/**
 * Whether one of a site's addresses opens it, looked at when the site loads
 * and after each publish, and again every few seconds for a while when the
 * answer is one that settles by itself (a new certificate, the old version
 * still cached).
 */
function useReach(siteId: string | null, target: "site" | "domain", enabled: boolean) {
  const [reach, setReach] = useState<Reach | null>(null);
  const [checking, setChecking] = useState(false);
  const left = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const check = useCallback(
    async (again = RECHECKS) => {
      if (!siteId) return null;
      if (timer.current) clearTimeout(timer.current);
      left.current = again;
      setChecking(true);
      const r = await api<{ reach: Reach }>("/api/sites", {
        method: "POST",
        body: JSON.stringify({ action: "reach", siteId, target }),
      });
      setChecking(false);
      if (!r.ok) {
        // The check itself failed (a network blip, a rate limit): try again
        // later rather than stop quietly while the line says it will.
        if (again > 0) timer.current = setTimeout(() => void check(again - 1), RECHECK_MS);
        return null;
      }
      setReach(r.data.reach);
      return r.data.reach;
    },
    [siteId, target],
  );

  /** Take a result found elsewhere (the publish itself checks once). */
  const accept = useCallback((r: Reach | null) => {
    left.current = RECHECKS;
    setReach(r);
  }, []);

  useEffect(() => {
    setReach(null);
    if (enabled && siteId) void check();
  }, [enabled, siteId, check]);

  useEffect(() => {
    if (!enabled || !reach || reach.ok || !SETTLING.has(reach.stage) || left.current <= 0) return;
    timer.current = setTimeout(() => void check(left.current - 1), RECHECK_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reach, enabled, check]);

  return { reach, checking, check, accept };
}

function ReachLine({
  reach,
  checking,
  onCheck,
}: {
  reach: Reach | null;
  checking: boolean;
  onCheck: () => void;
}) {
  const settling = reach && !reach.ok && SETTLING.has(reach.stage);
  return (
    <div
      className={cn(
        "mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]",
        !reach
          ? "bg-surface-2 text-muted-foreground"
          : reach.ok
            ? "bg-success/10 text-success"
            : settling
              ? "bg-warning/10 text-warning"
              : "bg-danger/10 text-danger",
      )}
      role="status"
    >
      {!reach || checking ? (
        <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
      ) : reach.ok ? (
        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        {!reach
          ? "Checking that the address opens your app…"
          : reach.ok
            ? `Reachable: ${reach.host} opens this version of your app.`
            : reach.message}
        {reach && settling && !checking && " Checking again shortly."}
      </span>
      <button
        onClick={onCheck}
        disabled={checking}
        className="shrink-0 font-medium underline-offset-2 hover:underline disabled:opacity-60"
      >
        Check now
      </button>
    </div>
  );
}

function PublishPage() {
  const ready = useAuth((s) => s.ready);
  const signedIn = useAuth((s) => !!s.account);
  const projects = useProjects((s) => s.projects);
  const hydrated = useProjects((s) => s.hydrated);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [site, setSite] = useState<SiteView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [sitesDomain, setSitesDomain] = useState("devstation.online");
  const [customDomains, setCustomDomains] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugState, setSlugState] = useState<{ ok: boolean; message: string | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<DomainStatus | null>(null);
  const [confirmDown, setConfirmDown] = useState(false);
  const live = useReach(site?.id ?? null, "site", !!site);
  const domainLive = useReach(
    site?.id ?? null,
    "domain",
    !!site?.customDomain && !!site.domainVerified,
  );

  useEffect(() => {
    useAuth.getState().init();
    void useProjects.getState().hydrate();
    setProjectId(new URLSearchParams(window.location.search).get("project"));
  }, []);
  const project = projects.find((p) => p.id === projectId) ?? null;
  const workspace = project?.workspaceId ?? null;

  const load = useCallback(async () => {
    if (!workspace) return;
    const r = await api<{ sites: SiteView[]; sitesDomain: string; customDomains: boolean }>(
      `/api/sites?workspace=${encodeURIComponent(workspace)}`,
    );
    if (r.ok) {
      setSite(r.data.sites[0] ?? null);
      setSitesDomain(r.data.sitesDomain);
      setCustomDomains(r.data.customDomains);
    }
    setLoaded(true);
  }, [workspace]);
  useEffect(() => {
    if (ready && signedIn && workspace) void load();
  }, [ready, signedIn, workspace, load]);
  useEffect(() => {
    if (project && !slug) setSlug(slugify(project.name));
  }, [project, slug]);

  // Is the name free? Checked a moment after typing stops.
  useEffect(() => {
    if (site || !slug) return;
    setSlugState(null);
    const t = setTimeout(async () => {
      const r = await api<{ available: boolean; message: string | null }>("/api/sites", {
        method: "POST",
        body: JSON.stringify({ action: "check", slug, workspace }),
      });
      if (r.ok) setSlugState({ ok: r.data.available, message: r.data.message });
    }, 400);
    return () => clearTimeout(t);
  }, [slug, site, workspace]);

  useEffect(() => {
    if (site?.customDomain && customDomains) void checkDomain(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site?.id, site?.customDomain, customDomains]);

  const publish = async () => {
    if (!workspace || !project) return;
    setBusy("publish");
    const r = await api<{ site: SiteView; url: string; reach: Reach | null }>("/api/workspace", {
      method: "POST",
      body: JSON.stringify({
        action: "publish_site",
        id: workspace,
        slug: site?.slug ?? slug,
        name: project.name,
      }),
    });
    setBusy(null);
    if (!r.ok) return void toast.error(r.message);
    useProjects.getState().update(project.id, { liveUrl: r.data.url });
    await load();
    // Uploaded is not reachable: say which it is.
    const reach = r.data.reach;
    live.accept(reach);
    if (!reach) {
      void live.check();
      toast.success("Published. Checking that the address opens it…");
    } else if (reach.ok) {
      toast.success(
        site
          ? "Published again: the live app is up to date."
          : `Your app is live at ${reach.host}.`,
      );
    } else if (SETTLING.has(reach.stage)) {
      toast.message("Published. The address is not showing it yet; checking again shortly.");
    } else {
      toast.error(`Published, but ${reach.host} cannot be opened yet.`);
    }
  };

  const checkDomain = async (say = true) => {
    if (!site) return;
    setBusy("check");
    const r = await api<{ site: SiteView; status: DomainStatus }>("/api/sites", {
      method: "POST",
      body: JSON.stringify({ action: "check_domain", siteId: site.id }),
    });
    setBusy(null);
    if (!r.ok) return void (say && toast.error(r.message));
    setStatus(r.data.status);
    setSite(r.data.site);
    if (say) {
      if (r.data.status.verified && r.data.status.configured && r.data.status.owned)
        toast.success("Your domain is live.");
      else toast.message("Not yet: DNS changes can take a few minutes, sometimes longer.");
    }
  };

  const addDomain = async () => {
    if (!site) return;
    setBusy("domain");
    const r = await api<{ site: SiteView; status: DomainStatus }>("/api/sites", {
      method: "POST",
      body: JSON.stringify({ action: "add_domain", siteId: site.id, domain: domain.trim() }),
    });
    setBusy(null);
    if (!r.ok) return void toast.error(r.message);
    setSite(r.data.site);
    setStatus(r.data.status);
    setDomain("");
  };

  const removeDomain = async () => {
    if (!site) return;
    setBusy("remove-domain");
    const r = await api<{ site: SiteView }>("/api/sites", {
      method: "POST",
      body: JSON.stringify({ action: "remove_domain", siteId: site.id }),
    });
    setBusy(null);
    if (!r.ok) return void toast.error(r.message);
    setSite(r.data.site);
    setStatus(null);
  };

  const unpublish = async () => {
    if (!site || !project) return;
    setBusy("down");
    const r = await api("/api/sites", {
      method: "POST",
      body: JSON.stringify({ action: "unpublish", siteId: site.id }),
    });
    setBusy(null);
    setConfirmDown(false);
    if (!r.ok) return void toast.error(r.message);
    toast.success("Unpublished. The address no longer shows the app.");
    useProjects.getState().update(project.id, { liveUrl: null });
    setSite(null);
  };

  const deployElsewhere = () => {
    if (!project) return;
    window.location.assign(`/?project=${encodeURIComponent(project.id)}&deploy=own`);
  };

  return (
    <PageShell
      title="Publish"
      description={
        project
          ? `Put ${project.name} on the web, at an address of its own.`
          : "Put your app on the web, at an address of its own."
      }
    >
      {!ready || !hydrated || (workspace && !loaded) ? (
        <p className="flex items-center gap-2 text-[13.5px] text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading
        </p>
      ) : !signedIn ? (
        <Note>Sign in with your email to publish.</Note>
      ) : !project ? (
        <Note>That project is not on this device. Open it from your projects, then publish.</Note>
      ) : !workspace ? (
        <Note>Ask the agent to build something first; then it can be published.</Note>
      ) : (
        <div className="space-y-5">
          <section className="rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-primary" />
              <p className="text-[15px] font-semibold">DevStation hosting</p>
              <span className="rounded-md bg-success/10 px-1.5 py-0.5 text-[11.5px] font-medium text-success">
                Free
              </span>
            </div>
            {site ? (
              <>
                <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      !live.reach
                        ? "bg-meta"
                        : live.reach.ok
                          ? "bg-success"
                          : SETTLING.has(live.reach.stage)
                            ? "bg-warning"
                            : "bg-danger",
                    )}
                    aria-hidden
                  />
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-foreground hover:underline"
                  >
                    {site.url.replace(/^https:\/\//, "")}
                  </a>
                  <IconButton
                    label="Copy the address"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(site.url)
                        .then(() => toast.success("Copied."))
                        .catch(() => toast.error("Copying is blocked here."))
                    }
                  >
                    <Copy className="h-4 w-4" />
                  </IconButton>
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    Open <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                <ReachLine
                  reach={live.reach}
                  checking={live.checking}
                  onCheck={() => void live.check()}
                />
                {live.reach?.ok && project && (
                  <p className="mt-2 text-[13px] text-muted-foreground">
                    How did publishing go?{" "}
                    <a
                      href={pageHref(`/feedback?project=${encodeURIComponent(project.id)}`)}
                      className="font-medium text-primary hover:underline"
                    >
                      Tell us
                    </a>
                  </p>
                )}
                <p className="mt-2 text-[12.5px] text-meta">
                  {site.files} files · {(site.bytes / 1_000_000).toFixed(1)} MB
                  {site.deployedAt &&
                    ` · published ${new Date(site.deployedAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}`}
                </p>
                <button
                  onClick={() => void publish()}
                  disabled={!!busy}
                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border px-4 text-[13.5px] font-medium transition hover:bg-surface-2 disabled:opacity-60"
                >
                  {busy === "publish" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  Publish latest
                </button>
              </>
            ) : (
              <>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Choose its address. You can add a domain of your own after.
                </p>
                <label className="mt-4 flex h-11 items-center rounded-xl border border-border bg-background pl-3 focus-within:border-primary/60">
                  <input
                    value={slug}
                    onChange={(e) =>
                      setSlug(
                        e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9-]/g, "")
                          .slice(0, 40),
                      )
                    }
                    aria-label="Address"
                    className="min-w-0 flex-1 bg-transparent text-[14.5px] font-medium text-foreground outline-none"
                  />
                  <span className="shrink-0 pr-3 text-[14.5px] text-muted-foreground">
                    .{sitesDomain}
                  </span>
                </label>
                <p
                  className={cn(
                    "mt-1.5 min-h-[18px] text-[12.5px]",
                    slugState?.ok === false ? "text-danger" : "text-success",
                  )}
                >
                  {slugState === null
                    ? ""
                    : slugState.ok
                      ? "Available"
                      : (slugState.message ?? "Not available")}
                </p>
                <button
                  onClick={() => void publish()}
                  disabled={!!busy || !slugState?.ok}
                  className="mt-3 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
                >
                  {busy === "publish" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  {busy === "publish" ? "Publishing…" : "Publish"}
                </button>
              </>
            )}
          </section>

          {site && (
            <section className="rounded-2xl border border-border bg-surface p-5">
              <div className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <p className="text-[15px] font-semibold">Your own domain</p>
              </div>
              {!customDomains ? (
                <p className="mt-2 text-[13px] text-muted-foreground">
                  Custom domains open soon on DevStation.
                </p>
              ) : site.customDomain ? (
                <div className="mt-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-medium">{site.customDomain}</span>
                    {site.domainVerified ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-1.5 py-0.5 text-[11.5px] font-medium text-success">
                        <Check className="h-3 w-3" /> Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-1.5 py-0.5 text-[11.5px] font-medium text-warning">
                        <TriangleAlert className="h-3 w-3" /> Waiting for DNS
                      </span>
                    )}
                  </div>
                  {site.domainVerified && (
                    <ReachLine
                      reach={domainLive.reach}
                      checking={domainLive.checking}
                      onCheck={() => void domainLive.check()}
                    />
                  )}
                  {!site.domainVerified && status && (
                    <>
                      <p className="mt-3 text-[13px] text-muted-foreground">
                        Add these records where your domain is managed (your registrar or DNS host),
                        then check again. The TXT record proves the domain is yours, so nobody else
                        can claim it:
                      </p>
                      <div className="mt-2 overflow-x-auto rounded-xl border border-border">
                        <table className="w-full text-[13px]">
                          <thead>
                            <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-wide text-meta">
                              <th className="px-3 py-2 font-medium">Type</th>
                              <th className="px-3 py-2 font-medium">Name</th>
                              <th className="px-3 py-2 font-medium">Value</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border font-mono">
                            {status.records.map((r) => (
                              <tr key={`${r.type}-${r.name}-${r.value}`}>
                                <td className="px-3 py-2">{r.type}</td>
                                <td className="px-3 py-2">{r.name}</td>
                                <td className="break-all px-3 py-2">{r.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {!site.domainVerified && (
                      <button
                        onClick={() => void checkDomain()}
                        disabled={!!busy}
                        className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-60"
                      >
                        {busy === "check" && <LoaderCircle className="h-4 w-4 animate-spin" />}
                        Check again
                      </button>
                    )}
                    <button
                      onClick={() => void removeDomain()}
                      disabled={!!busy}
                      className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[13.5px] text-muted-foreground hover:text-danger disabled:opacity-60"
                    >
                      Remove domain
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void addDomain();
                  }}
                  className="mt-3 flex flex-col gap-2 sm:flex-row"
                >
                  <input
                    value={domain}
                    onChange={(e) => setDomain(e.target.value.trim().toLowerCase())}
                    placeholder="app.yourdomain.com"
                    aria-label="Your domain"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-[14px] outline-none focus:border-primary/60"
                  />
                  <button
                    type="submit"
                    disabled={!!busy || domain.length < 4}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13.5px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
                  >
                    {busy === "domain" && <LoaderCircle className="h-4 w-4 animate-spin" />}
                    Add domain
                  </button>
                </form>
              )}
            </section>
          )}

          <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-5">
            <div>
              <p className="text-[14.5px] font-medium">Deploy to your own hosting</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                The agent deploys to the Netlify or Vercel account you connected.
              </p>
            </div>
            <button
              onClick={deployElsewhere}
              className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[13.5px] font-medium hover:bg-surface-2"
            >
              Ask the agent
            </button>
          </section>

          {site && (
            <div className="pt-2">
              {confirmDown ? (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/5 p-3">
                  <p className="flex-1 text-[13px]">
                    Take {site.url.replace(/^https:\/\//, "")} down? The address stops showing the
                    app{site.customDomain ? `, and ${site.customDomain} is released` : ""}.
                  </p>
                  <button
                    onClick={() => setConfirmDown(false)}
                    className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground"
                  >
                    Keep it
                  </button>
                  <button
                    onClick={() => void unpublish()}
                    disabled={!!busy}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-60"
                  >
                    {busy === "down" && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
                    Unpublish
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDown(true)}
                  className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Unpublish this app
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-border bg-surface px-5 py-6 text-center text-[14px] text-muted-foreground">
      {children}
    </p>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-surface-2 hover:text-foreground"
    >
      {children}
    </button>
  );
}
