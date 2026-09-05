import { useEffect } from "react";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import {
  BadgeCheck,
  Boxes,
  Clock,
  ExternalLink,
  Globe,
  Rocket,
  ShieldCheck,
  Store,
  Ticket,
  Wand2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useProjectRegistry } from "@/hooks/useProjectRegistry";
import { useProjects as useDeployedProjects } from "@/lib/data/projects";
import { useProjects as useApps, fileCount } from "@/lib/appgen/projects";
import { useNetworkPref } from "@/lib/active-chain";
import { chainConfig, isQieChain } from "@/lib/chains";
import { qieIdAddress, isContractConfigured } from "@/lib/contracts";
import { devstationExplorerBase, slugForChainId } from "@/lib/explorer/network";
import { shortAddr, timeAgo } from "@/lib/explorer/format";
import { deriveReputation, reputationSummary, TIER_LABEL } from "@/lib/reputation";
import { useTemplateRegistry } from "@/hooks/useTemplateRegistry";
import { useQieIdentity } from "@/hooks/useQieIdentity";
import { useQiePass } from "@/hooks/useQiePass";
import { describePass, formatWalletAge } from "@/lib/qie/identity";

// Your dashboard: everything DevStation knows about the connected wallet, in
// one place.
//
// It replaced an ecosystem-wide feed of every deploy by every user. That view
// answered "what is happening on DevStation"; this one answers "where do I
// stand", which is the question a developer actually opens a dashboard to ask.
//
// Every figure here is read from a contract or from your own stored work.
// Nothing is estimated, and a signal with no data behind it says so rather
// than showing a zero that looks like a real one.

export const Route = createFileRoute("/activity")({
  head: () => ({ meta: [{ title: "Dashboard: DevStation" }] }),
  // Gated on the shared map, never on a flag local to this file: the
  // sidebar badge reads the same entry, so the two cannot disagree.
  // DashboardPage stays referenced, so removing the map entry is all it takes
  // to bring the page back.
  component: () =>
    isComingSoon("/activity") ? <ComingSoon path="/activity" /> : <DashboardPage />,
});

function DashboardPage() {
  const { address, isConnected } = useAccount();
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const chain = chainConfig(chainId);

  const { deployments } = useProjectRegistry();
  const localDeploys = useDeployedProjects((s) => s.projects);
  const apps = useApps((s) => s.projects);
  const hydrateApps = useApps((s) => s.hydrate);
  useEffect(() => hydrateApps(), [hydrateApps]);

  // Registry first, local records for anything not yet mirrored on chain.
  const seen = new Set(deployments.map((d) => d.txHash));
  const mine = [
    ...deployments,
    ...localDeploys.filter(
      (p) => !seen.has(p.txHash) && (!address || p.deployer === address.toLowerCase()),
    ),
  ];

  // Templates this wallet published, and how often others deployed them. The
  // registry has no per-creator aggregate, so the summaries are filtered by
  // creator here: cheap, since the same query already backs the marketplace.
  const templateRegistry = useTemplateRegistry();
  const myTemplates = templateRegistry.summaries.filter(
    (t) => address && t.creator.toLowerCase() === address.toLowerCase(),
  );
  const templateCredit = templateRegistry.configured
    ? {
        published: myTemplates.length,
        deploys: myTemplates.reduce((n, t) => n + t.deployCount, 0),
      }
    : null;

  const reputation = deriveReputation(
    mine.map((p) => ({
      contractAddress: p.address,
      templateId: p.templateId ?? "",
      projectName: p.name ?? "",
      network: p.chainId ? chainConfig(p.chainId).name : "",
      deployedAt: p.deployedAt ?? 0,
      txHash: p.txHash ?? "",
    })),
    null,
    templateCredit,
  );
  const verified = mine.filter((p) => p.status === "VERIFIED").length;

  // --- QIE identity -------------------------------------------------------
  // The QIE-native identity layer: name, names held, wallet age. Verification
  // needs QIE Pass credentials and the user's consent, so it is not fetched
  // here: see api.qie-identity.ts.
  const { data: identity, isLoading: identityLoading } = useQieIdentity(address, chainId);
  const primaryName = identity?.names[0] ?? null;

  const qieId = qieIdAddress(chainId);

  // QIE Pass is QIE's identity verification service, not a contract anyone
  // deploys. Its status comes from QIE's partner API, which needs credentials
  // AND the user's consent, so with neither present the honest answer is
  // simply that this wallet has not verified.
  const { data: passConfig } = useQuery({
    queryKey: ["qie-pass-configured"],
    queryFn: async () => {
      const r = await fetch("/api/qie-identity");
      return r.ok ? ((await r.json()) as { configured: boolean }) : { configured: false };
    },
    staleTime: Infinity,
    retry: false,
  });
  const passConfigured = passConfig?.configured === true;
  // The flow the user drives. identity.pass stays null by design: a
  // verification request notifies a real person, so it is never fetched
  // passively; this hook owns the state once they ask for it.
  const qiePass = useQiePass(passConfigured);
  const passDescription = describePass(qiePass.pass);
  const passVerified = qiePass.verified;

  const explorer = devstationExplorerBase(slugForChainId(chainId));

  if (!isConnected) {
    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "Dashboard"]}
          title="Your dashboard"
          subtitle="Reputation, apps, contracts and QIE identity for the connected wallet."
        />
        <div className="p-6">
          <div className="rounded border border-dashed border-border p-12 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Connect a wallet to see your dashboard.
            </p>
            <p className="mt-1 font-mono text-[10px] text-meta">
              Everything here is scoped to one wallet and read from chain.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Dashboard"]}
        title="Your dashboard"
        subtitle="Reputation, apps, contracts and QIE identity for the connected wallet."
      />

      <div className="space-y-6 p-6">
        {/* Identity */}
        <div className="rounded border border-border bg-surface p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
            {/* self-start: in the stacked mobile column a span stretches to
                full width, which reads as a banner rather than a badge. */}
            <span className="w-fit self-start rounded border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
              {TIER_LABEL[reputation.tier]}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              {primaryName && (
                <span className="truncate font-mono text-sm font-bold text-foreground">
                  {primaryName.full}
                  {primaryName.confidence === "positional" && (
                    <span
                      className="ml-1 text-[10px] font-normal text-meta"
                      title="Registered alongside other names in one transaction, so it is matched by position rather than uniquely."
                    >
                      ~
                    </span>
                  )}
                </span>
              )}
              <a
                href={`${explorer}/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-primary"
              >
                {shortAddr(address ?? "")} <ExternalLink className="h-3 w-3" />
              </a>
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {reputationSummary(reputation)}
            </span>
            <span className="font-mono text-[10px] text-meta sm:ml-auto">on {chain.name}</span>
          </div>
          <p className="mt-2 font-mono text-[10px] text-meta">
            Standing is derived from the onchain ProjectRegistry, every deployment counted here cost
            gas, so nothing in it can be self-awarded.
          </p>
        </div>

        {/* Headline numbers */}
        {/* 2x2 on a phone. One tile per row turned four numbers into a long
            scroll; a KPI row has to be readable at a glance, which means seeing
            more than one of them at once. */}
        <div
          className={`grid grid-cols-2 gap-2.5 sm:gap-3 ${
            templateCredit && templateCredit.published > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"
          }`}
        >
          <Stat
            icon={Rocket}
            label="Contracts"
            value={reputation.deployments}
            sub={`${verified} verified`}
          />
          <Stat
            icon={Wand2}
            label="Apps built"
            value={apps.length}
            sub={apps.length ? `${apps.reduce((n, a) => n + fileCount(a), 0)} files` : "none yet"}
          />
          <Stat
            icon={Globe}
            label="Networks"
            value={reputation.networks.length}
            sub={reputation.networks.join(", ") || "-"}
          />
          <Stat
            icon={Boxes}
            label="Templates used"
            value={reputation.templates.length}
            sub={reputation.activeDays >= 1 ? `active ${reputation.activeDays} days` : "-"}
          />
          {/* Only for wallets that have actually published something. A
              permanent "0 published" tile would push the common case to five
              numbers to say nothing. */}
          {templateCredit && templateCredit.published > 0 && (
            <Stat
              icon={Store}
              label="Published"
              value={templateCredit.published}
              sub={`used ${templateCredit.deploys} time${templateCredit.deploys === 1 ? "" : "s"}`}
            />
          )}
        </div>

        {/* QIE identity */}
        <section>
          <SectionTitle>QIE identity</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <IdentityCard
              icon={BadgeCheck}
              label="QIE ID"
              state={
                !isQieChain(chainId) || !isContractConfigured(qieId)
                  ? "n/a"
                  : identityLoading
                    ? "none"
                    : (identity?.nameCount ?? 0) > 0
                      ? "yes"
                      : "no"
              }
              value={
                !isQieChain(chainId) || !isContractConfigured(qieId)
                  ? "Not on this network"
                  : identityLoading
                    ? "Resolving…"
                    : primaryName
                      ? primaryName.full
                      : (identity?.nameCount ?? 0) > 0
                        ? `${identity?.nameCount} name${identity?.nameCount === 1 ? "" : "s"} held`
                        : "No .qie name"
              }
              note={
                !isQieChain(chainId) || !isContractConfigured(qieId)
                  ? "The .qie registry is deployed on QIE mainnet only."
                  : (identity?.nameCount ?? 0) > 1
                    ? `${identity?.nameCount} names held · ownership verified onchain`
                    : primaryName
                      ? "Read from the registration and verified against current ownership."
                      : "Read from the .qie ERC-721 on QIE mainnet."
              }
            />

            <IdentityCard
              icon={Clock}
              label="Wallet age"
              state={identity?.walletAgeMs != null ? "yes" : "none"}
              value={identityLoading ? "…" : formatWalletAge(identity?.walletAgeMs ?? null)}
              note={
                identity?.firstSeenAt
                  ? `First activity ${new Date(identity.firstSeenAt).toLocaleDateString()}`
                  : "No activity found for this wallet."
              }
            />

            <IdentityCard
              icon={Ticket}
              label="QIE Pass"
              state={
                passVerified
                  ? "yes"
                  : passDescription.tone === "rejected"
                    ? "no"
                    : passDescription.tone === "pending"
                      ? "none"
                      : "no"
              }
              value={
                !passConfigured
                  ? "Verification unavailable"
                  : qiePass.phase === "signing"
                    ? "Waiting for your signature…"
                    : qiePass.phase === "creating"
                      ? "Starting verification…"
                      : passVerified
                        ? "Verified"
                        : passDescription.tone === "none"
                          ? "Not verified"
                          : passDescription.label
              }
              note={
                !passConfigured ? (
                  "QIE Pass is not configured on this deployment."
                ) : qiePass.error ? (
                  <span className="text-danger">{qiePass.error}</span>
                ) : passVerified ? (
                  "Identity verified through QIE Pass."
                ) : qiePass.phase === "waiting" ? (
                  <>
                    Approve the request in QIE Pass: this updates automatically.{" "}
                    {qiePass.pass?.redirectUrl && (
                      <a
                        href={qiePass.pass.redirectUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline"
                      >
                        Open QIE Pass ↗
                      </a>
                    )}
                  </>
                ) : (
                  <button
                    onClick={() => void qiePass.start()}
                    disabled={qiePass.phase === "signing" || qiePass.phase === "creating"}
                    className="text-primary hover:underline disabled:opacity-50"
                  >
                    Verify with QIE Pass →
                  </button>
                )
              }
            />
          </div>
        </section>

        {/* Apps */}
        <section>
          <SectionTitle
            action={
              <Link
                to="/launchkit/apps"
                className="font-mono text-[10px] text-primary hover:underline"
              >
                All apps →
              </Link>
            }
          >
            Apps
          </SectionTitle>
          {apps.length === 0 ? (
            <Empty>
              Nothing built yet.{" "}
              <Link to="/launchkit/app-builder" className="text-primary hover:underline">
                Describe an app
              </Link>{" "}
              and it appears here.
            </Empty>
          ) : (
            <ul className="divide-y divide-border rounded border border-border bg-surface">
              {apps.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-3 py-2.5">
                  <Wand2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-meta" />
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/launchkit/apps"
                      className="block truncate font-mono text-xs text-foreground hover:text-primary"
                    >
                      {a.name}
                    </Link>
                    {/* Under the name on a phone: side by side it either
                        overflowed or squeezed the name to nothing. */}
                    <div className="font-mono text-[10px] text-meta sm:hidden">
                      {fileCount(a)} files · {a.history.length} messages
                    </div>
                  </div>
                  <span className="hidden shrink-0 font-mono text-[10px] text-meta sm:inline">
                    {fileCount(a)} files · {a.history.length} messages ·{" "}
                    {timeAgo(new Date(a.updatedAt).toISOString())}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Contracts */}
        <section>
          <SectionTitle
            action={
              <Link
                to="/launchkit/projects"
                className="font-mono text-[10px] text-primary hover:underline"
              >
                All contracts →
              </Link>
            }
          >
            Contracts
          </SectionTitle>
          {mine.length === 0 ? (
            <Empty>
              No deployments for this wallet yet.{" "}
              <Link to="/launchkit/templates" className="text-primary hover:underline">
                Pick a template
              </Link>
              .
            </Empty>
          ) : (
            <ul className="divide-y divide-border rounded border border-border bg-surface">
              {mine.slice(0, 6).map((p) => (
                <li key={p.id ?? p.txHash} className="flex items-center gap-3 px-3 py-2.5">
                  <Rocket className="h-3.5 w-3.5 shrink-0 text-meta" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-foreground">{p.name}</div>
                    <div className="font-mono text-[10px] text-meta">
                      {p.templateName ?? p.templateId} ·{" "}
                      {p.chainId ? chainConfig(p.chainId).name : "unknown network"}
                    </div>
                  </div>
                  {p.status === "VERIFIED" && (
                    <span className="shrink-0 font-mono text-[10px] text-success">verified</span>
                  )}
                  <a
                    href={`${devstationExplorerBase(slugForChainId(p.chainId ?? chainId))}/address/${p.address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 font-mono text-[10px] text-meta hover:text-primary"
                  >
                    {shortAddr(p.address)} ↗
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface p-3 sm:p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 font-mono text-xl font-bold text-foreground sm:text-2xl">{value}</div>
      {sub && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground sm:text-[11px]">
          {sub}
        </div>
      )}
    </div>
  );
}

/** A signal with no contract behind it says so, rather than showing a zero
 *  that looks like a real reading. */
function IdentityCard({
  icon: Icon,
  label,
  state,
  value,
  note,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  state: "yes" | "no" | "none" | "n/a";
  value: React.ReactNode;
  note?: React.ReactNode;
}) {
  const dot = state === "yes" ? "bg-success" : state === "no" ? "bg-warning" : "bg-meta";
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1.5 flex items-start gap-2">
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="min-w-0 font-mono text-[13px] font-medium leading-snug text-foreground sm:text-sm">
          {value}
        </span>
      </div>
      {note && <div className="mt-1.5 font-mono text-[10px] text-meta">{note}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-border px-4 py-8 text-center font-mono text-xs text-meta">
      {children}
    </div>
  );
}
