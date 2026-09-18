import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AppWindow,
  Award,
  BadgeCheck,
  Check,
  Coins,
  Copy,
  ExternalLink,
  Flame,
  Gift,
  Globe,
  Layers,
  Lock,
  RefreshCw,
  Rocket,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Tags,
  Trophy,
  Wallet,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuilderOverview } from "@/hooks/useBuilderOverview";
import { useQieIdentity } from "@/hooks/useQieIdentity";
import { useProjects as useApps, fileCount } from "@/lib/appgen/projects";
import { nativeSymbol } from "@/lib/chains";
import { devstationExplorerBase, slugForChainId } from "@/lib/explorer/network";
import { shortAddr, timeAgo } from "@/lib/explorer/format";
import { QIE_ID_REGISTER_URL, formatWalletAge } from "@/lib/qie/identity";
import { achievementsFor, tierProgress, type Achievement } from "@/lib/builder/achievements";
import { buildHeatmap, mergeTimeline, type ActivityEvent } from "@/lib/builder/activity";
import {
  formatAmount,
  formatPrice,
  kindFromCode,
  kindInfo,
  listingId,
  type Currency,
} from "@/lib/marketplace/listing";
import type { BuilderChain, BuilderOverview } from "@/lib/api/builder.functions";
import { ActivityHeatmap } from "./ActivityHeatmap";
import { BuilderName, Identicon } from "./BuilderName";
import { AccountPanel } from "./AccountPanel";

// A builder's dashboard and public profile, in one component.
//
// `owner` is true when the connected wallet is the one being viewed. The owner
// additionally sees work that lives only in their browser (apps they built) and
// the actions that are theirs to take (withdraw, get a .qie name). Everything
// else is the same for every viewer, because it is read from chain.

const cur = (code: number): Currency => (code === 1 ? "QUSDC" : "QIE");

export function BuilderDashboard({ address, owner }: { address: string; owner: boolean }) {
  const overview = useBuilderOverview(address);
  const identity = useQieIdentity(address);
  const apps = useApps((s) => s.projects);
  const hydrateApps = useApps((s) => s.hydrate);
  useEffect(() => {
    if (owner) hydrateApps();
  }, [owner, hydrateApps]);
  const myApps = owner
    ? apps.filter((a) => !a.owner || a.owner.toLowerCase() === address.toLowerCase())
    : [];

  const data = overview.data;
  const model = useMemo(() => (data ? summarize(data) : null), [data]);

  const names = identity.data?.names ?? [];
  const primary = names[0] ?? null;
  const walletAgeDays =
    identity.data?.walletAgeMs != null ? Math.floor(identity.data.walletAgeMs / 86_400_000) : null;

  const heatmapStamps = useMemo(() => {
    if (!model) return [];
    const stamps = [...model.walletActivity, ...model.incomingMarketTimes];
    if (model.walletActivity.length === 0) {
      stamps.push(...model.deployments.map((d) => d.deployedAt), ...model.labels.map((l) => l.at));
    }
    if (owner) stamps.push(...myApps.map((a) => a.updatedAt));
    return stamps;
  }, [model, owner, myApps]);

  const streak = useMemo(() => buildHeatmap(heatmapStamps).longestStreak, [heatmapStamps]);

  const facts = model
    ? {
        deployments: model.contracts,
        verified: model.verified,
        networks: model.networksActive.length,
        templatesUsed: model.templatesUsed,
        templateDeploys: model.templateDeploys,
        listings: model.listings.length,
        sales: model.sales,
        paidDeploys: model.paidDeploys,
        tipsReceived: model.tipsReceived,
        appsBuilt: myApps.length,
        appsPublished: data?.sites?.length ?? 0,
        labels: model.labels.length,
        qieNames: identity.data?.nameCount ?? 0,
        walletAgeDays,
        longestStreak: streak,
        leaderboardRank: model.bestRank?.rank ?? null,
      }
    : null;

  const timeline = useMemo(() => {
    if (!model || !data) return [];
    const events: ActivityEvent[] = [...model.events];
    for (const site of data.sites ?? []) {
      events.push({
        kind: "app",
        at: site.updatedAt,
        title: `Published ${site.slug}.devstation.online`,
        href: site.url,
        external: true,
        key: `site:${site.slug}`,
      });
    }
    if (owner) {
      for (const app of myApps) {
        events.push({
          kind: "app",
          at: app.createdAt,
          title: `Started building ${app.name}`,
          detail: `${fileCount(app)} files`,
          href: `/launchkit/apps/${app.id}`,
          key: `app:${app.id}`,
        });
      }
    }
    return mergeTimeline(events, 40);
  }, [model, data, owner, myApps]);

  const tier = model
    ? tierProgress(model.contracts, model.templateDeploys + model.paidDeploys)
    : null;
  const achievements = facts ? achievementsFor(facts) : [];
  const earnedCount = achievements.filter((a) => a.earned).length;
  const mainnet = data?.chains.find((c) => !c.testnet) ?? null;

  return (
    <div className="space-y-6 px-5 py-6 sm:px-8 lg:px-12">
      {/* ---------------------------------------------------------------- hero */}
      <section className="relative overflow-hidden rounded-xl border border-border bg-surface">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-info/10" />
        <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_auto]">
          <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start">
            <Identicon address={address} size={72} className="ring-2 ring-primary/40" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {tier && (
                  <span className="rounded border border-primary/50 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-wider text-primary">
                    {tier.label}
                  </span>
                )}
                {owner && (
                  <span className="rounded border border-border px-2 py-0.5 font-mono text-[10px] uppercase text-meta">
                    You
                  </span>
                )}
                {model?.bestRank && (
                  <span className="inline-flex items-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-0.5 font-mono text-[10px] text-warning">
                    <Trophy className="h-3 w-3" /> #{model.bestRank.rank} on {model.bestRank.chain}
                  </span>
                )}
              </div>
              <h1 className="mt-2 flex min-w-0 items-center gap-2 font-mono text-2xl font-bold text-foreground">
                <span className="truncate">
                  {identity.isLoading ? "…" : primary ? primary.full : shortAddr(address)}
                </span>
                {primary && (
                  <BadgeCheck className="h-5 w-5 shrink-0 text-info" aria-label="QIE ID" />
                )}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <CopyAddress address={address} />
                <a
                  href={`${devstationExplorerBase(slugForChainId(mainnet?.chainId ?? 1990))}/address/${address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-primary"
                >
                  Explorer <ExternalLink className="h-3 w-3" />
                </a>
                <ShareProfile address={address} />
              </div>

              {names.length > 1 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {names.slice(1, 6).map((n) => (
                    <span
                      key={n.tokenId}
                      className="rounded bg-info/10 px-1.5 py-0.5 font-mono text-[10px] text-info"
                    >
                      {n.full}
                    </span>
                  ))}
                  {names.length > 6 && (
                    <span className="font-mono text-[10px] text-meta">
                      +{names.length - 6} more
                    </span>
                  )}
                </div>
              )}

              <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[11px] sm:grid-cols-4">
                <HeroFact
                  label="Wallet age"
                  value={
                    identity.isLoading ? "…" : formatWalletAge(identity.data?.walletAgeMs ?? null)
                  }
                />
                <HeroFact
                  label="First activity"
                  value={
                    identity.data?.firstSeenAt
                      ? new Date(identity.data.firstSeenAt).toLocaleDateString()
                      : "-"
                  }
                />
                <HeroFact
                  label="Networks"
                  value={model ? String(model.networksActive.length || 0) : "…"}
                />
                <HeroFact
                  label="QIE ID"
                  value={
                    identity.isLoading
                      ? "…"
                      : identity.data?.nameCount
                        ? `${identity.data.nameCount} name${identity.data.nameCount === 1 ? "" : "s"}`
                        : "none"
                  }
                />
              </dl>

              {tier && (
                <div className="mt-4 max-w-md">
                  <div className="flex items-center justify-between font-mono text-[10px] text-meta">
                    <span>{tier.label}</span>
                    <span>
                      {tier.next
                        ? `${tier.next.needed} more to ${tier.next.label}`
                        : "Top tier reached"}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary to-warning transition-all"
                      style={{ width: `${Math.round(tier.progress * 100)}%` }}
                    />
                  </div>
                </div>
              )}

              {owner && !identity.isLoading && (identity.data?.nameCount ?? 0) === 0 && (
                <a
                  href={QIE_ID_REGISTER_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 inline-flex items-center gap-1.5 rounded border border-info/40 bg-info/10 px-3 py-1.5 font-mono text-[11px] text-info hover:bg-info/20"
                >
                  <BadgeCheck className="h-3.5 w-3.5" /> Get a .qie name so people find you by name
                </a>
              )}
            </div>
          </div>

          <div className="grid min-w-[220px] content-start gap-2">
            {(data?.chains ?? []).map((c) =>
              c.wallet ? (
                <div
                  key={c.chainId}
                  className="rounded-lg border border-border bg-background/60 px-3 py-2"
                >
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-meta">
                    <span>{c.name}</span>
                    {c.testnet && (
                      <span className="rounded bg-surface-2 px-1 text-[9px]">test</span>
                    )}
                  </div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-foreground">
                    {c.wallet.balance !== null
                      ? formatAmount(BigInt(c.wallet.balance), "QIE")
                      : "-"}{" "}
                    <span className="text-[10px] font-normal text-meta">
                      {nativeSymbol(c.chainId)}
                    </span>
                  </div>
                  {c.wallet.qusdc !== null && (
                    <div className="font-mono text-xs text-muted-foreground">
                      {formatAmount(BigInt(c.wallet.qusdc), "QUSDC")}{" "}
                      <span className="text-[10px] text-meta">QUSDC</span>
                    </div>
                  )}
                </div>
              ) : null,
            )}
            {overview.isLoading && <Skeleton className="h-16" />}
          </div>
        </div>
      </section>

      {overview.isError && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 font-mono text-xs text-warning">
          This builder's on-chain history could not be read right now.{" "}
          <button onClick={() => void overview.refetch()} className="underline">
            Try again
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ numbers */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        {model ? (
          <>
            <Kpi
              icon={Rocket}
              label="Contracts"
              value={model.contracts}
              sub={`${model.verified} verified`}
            />
            <Kpi
              icon={ShieldCheck}
              label="Verified"
              value={model.checked ? `${Math.round((model.verified / model.checked) * 100)}%` : "-"}
              sub={model.checked ? `of ${model.checked} checked` : "nothing to check"}
            />
            <Kpi
              icon={Coins}
              label="Earned"
              value={formatEarned(model.earnedMainnet)}
              sub={model.eventsAvailable ? "95% share + tips, mainnet" : "history unavailable"}
            />
            <Kpi
              icon={ShoppingBag}
              label="Sales"
              value={model.sales + model.paidDeploys}
              sub={`${model.tipsReceived} tips`}
            />
            <Kpi
              icon={Store}
              label="Listings"
              value={model.listings.length}
              sub={`${model.listings.filter((l) => l.active && !l.hidden).length} live`}
            />
            <Kpi
              icon={AppWindow}
              label="Apps live"
              value={data?.sites?.length ?? "-"}
              sub={owner ? `${myApps.length} built` : "on devstation.online"}
            />
            <Kpi icon={Tags} label="Labels" value={model.labels.length} sub="contracts named" />
            <Kpi
              icon={Layers}
              label="Transactions"
              value={model.txCount ?? "-"}
              sub={model.tokenTransfers !== null ? `${model.tokenTransfers} token transfers` : ""}
            />
          </>
        ) : (
          Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[88px]" />)
        )}
      </section>

      {/* --------------------------------------------- activity + achievements */}
      <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-6">
          <Card
            title="Activity"
            icon={Flame}
            action={<span className="font-mono text-[10px] text-meta">last 12 months</span>}
          >
            {model ? <ActivityHeatmap timestamps={heatmapStamps} /> : <Skeleton className="h-32" />}
          </Card>

          <Card title="Recent activity" icon={Sparkles}>
            {!model ? (
              <Skeleton className="h-48" />
            ) : timeline.length === 0 ? (
              <Empty>
                Nothing on record yet. Deploy a contract or list something and it shows up here.
              </Empty>
            ) : (
              <ol className="relative space-y-3 border-l border-border pl-5">
                {timeline.map((e, i) => (
                  <TimelineItem key={`${e.kind}-${e.key ?? i}`} event={e} />
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title="Achievements"
            icon={Award}
            action={
              <span className="font-mono text-[10px] text-meta">
                {earnedCount} of {achievements.length}
              </span>
            }
          >
            {facts ? <Achievements list={achievements} /> : <Skeleton className="h-64" />}
          </Card>

          <Card title="How standing is earned" icon={Trophy}>
            <ul className="space-y-2 font-mono text-[11px] text-muted-foreground">
              <li>
                <span className="text-foreground">Tier</span> comes from contracts deployed plus
                times other people deployed or bought your work: Builder at 3, Regular at 10,
                Veteran at 25.
              </li>
              <li>
                <span className="text-foreground">Every number</span> here is read from
                ProjectRegistry, DevStationMarketplace, ContractLabelRegistry, the QIE ID contract
                and the block explorer. Nothing is self-reported.
              </li>
              {tier && (
                <li>
                  You are at <span className="text-primary">{tier.weight}</span>
                  {tier.next ? `, ${tier.next.needed} from ${tier.next.label}.` : ", the top tier."}
                </li>
              )}
            </ul>
          </Card>
        </div>
      </section>

      {/* ------------------------------------------------------------ account */}
      {/* Owner only: what this wallet is linked to is nobody else's business,
          and this same component renders the public profile. */}
      {owner && <AccountPanel />}

      {/* ----------------------------------------------------------- contracts */}
      <ContractsSection model={model} loading={overview.isLoading} />

      {/* --------------------------------------------------------- marketplace */}
      <MarketplaceSection data={data} owner={owner} />

      {/* ---------------------------------------------------------------- apps */}
      <section className="grid gap-6 lg:grid-cols-2">
        <Card title="Published apps" icon={Globe}>
          {!data ? (
            <Skeleton className="h-24" />
          ) : data.sites === null ? (
            <Empty>Published apps could not be read right now.</Empty>
          ) : data.sites.length === 0 ? (
            <Empty>No apps published yet.</Empty>
          ) : (
            <ul className="divide-y divide-border">
              {data.sites.map((site) => (
                <li key={site.slug} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <a
                      href={site.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-1 truncate font-mono text-xs text-foreground hover:text-primary"
                    >
                      {site.slug}.devstation.online <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    <div className="font-mono text-[10px] text-meta">
                      {site.fileCount} files · {Math.ceil(site.bytes / 1024)} KB · updated{" "}
                      {timeAgo(new Date(site.updatedAt).toISOString())}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {owner ? (
          <Card
            title="Apps you built"
            icon={Wand2}
            action={
              <Link
                to="/launchkit/apps"
                className="font-mono text-[10px] text-primary hover:underline"
              >
                All apps →
              </Link>
            }
          >
            {myApps.length === 0 ? (
              <Empty>
                Nothing built yet.{" "}
                <Link to="/launchkit/coding-agent" className="text-primary hover:underline">
                  Describe an app
                </Link>{" "}
                and it appears here.
              </Empty>
            ) : (
              <ul className="divide-y divide-border">
                {myApps.slice(0, 8).map((app) => (
                  <li key={app.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        to="/launchkit/apps/$id"
                        params={{ id: app.id }}
                        className="block truncate font-mono text-xs text-foreground hover:text-primary"
                      >
                        {app.name}
                      </Link>
                      <div className="font-mono text-[10px] text-meta">
                        {fileCount(app)} files · {app.history.length} messages ·{" "}
                        {timeAgo(new Date(app.updatedAt).toISOString())}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono text-[10px]">
                      {app.liveUrl && (
                        <a
                          href={app.liveUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-success hover:underline"
                        >
                          live
                        </a>
                      )}
                      {app.repo && (
                        <a
                          href={app.repo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-meta hover:text-primary"
                        >
                          GitHub
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <Card title="Labels contributed" icon={Tags}>
            <LabelsList model={model} />
          </Card>
        )}
      </section>

      {owner && (
        <Card title="Labels contributed" icon={Tags}>
          <LabelsList model={model} />
        </Card>
      )}

      {/* ------------------------------------------------------------ networks */}
      <Card title="By network" icon={Layers}>
        {!data ? (
          <Skeleton className="h-24" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left font-mono text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-meta">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-normal">Network</th>
                  <th className="py-2 pr-3 text-right font-normal">Contracts</th>
                  <th className="py-2 pr-3 text-right font-normal">Listings</th>
                  <th className="py-2 pr-3 text-right font-normal">Sales</th>
                  <th className="py-2 pr-3 text-right font-normal">Labels</th>
                  <th className="py-2 pr-3 text-right font-normal">Transactions</th>
                  <th className="py-2 text-right font-normal">Rank</th>
                </tr>
              </thead>
              <tbody>
                {data.chains.map((c) => (
                  <tr key={c.chainId} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 text-foreground">
                      {c.name}
                      {c.testnet && (
                        <span className="ml-2 rounded bg-surface-2 px-1 text-[9px] text-meta">
                          test
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{cell(c.deployments?.total)}</td>
                    <td className="py-2 pr-3 text-right">{cell(c.marketplace?.listings.length)}</td>
                    <td className="py-2 pr-3 text-right">
                      {cell(
                        c.marketplace ? c.marketplace.sales + c.marketplace.paidDeploys : undefined,
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right">{cell(c.labels?.length)}</td>
                    <td className="py-2 pr-3 text-right">{cell(c.wallet?.txCount ?? undefined)}</td>
                    <td className="py-2 text-right">{c.rank ? `#${c.rank.rank}` : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-meta">
        <span>
          Read from QIE Mainnet{data && data.chains.some((c) => c.testnet) ? ", QIE Testnet" : ""}{" "}
          and their explorers
          {data ? ` · ${timeAgo(new Date(data.readAt).toISOString())}` : ""}
        </span>
        <button
          onClick={() => {
            void overview.refetch();
            void identity.refetch();
          }}
          disabled={overview.isFetching}
          className="inline-flex items-center gap-1 hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", overview.isFetching && "animate-spin")} /> Refresh
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ model

interface Model {
  contracts: number;
  verified: number;
  checked: number;
  templatesUsed: number;
  templateDeploys: number;
  networksActive: string[];
  deployments: Array<
    BuilderChain["deployments"] extends infer D
      ? D extends { items: (infer I)[] }
        ? I & { chainId: number; chain: string }
        : never
      : never
  >;
  listings: Array<
    NonNullable<BuilderChain["marketplace"]>["listings"][number] & {
      chainId: number;
      testnet: boolean;
    }
  >;
  sales: number;
  paidDeploys: number;
  tipsReceived: number;
  earnedMainnet: Record<Currency, bigint>;
  eventsAvailable: boolean;
  labels: Array<NonNullable<BuilderChain["labels"]>[number] & { chainId: number }>;
  bestRank: { rank: number; chain: string } | null;
  txCount: number | null;
  tokenTransfers: number | null;
  walletActivity: number[];
  incomingMarketTimes: number[];
  events: ActivityEvent[];
}

function summarize(data: BuilderOverview): Model {
  const deployments: Model["deployments"] = [];
  const listings: Model["listings"] = [];
  const labels: Model["labels"] = [];
  const events: ActivityEvent[] = [];
  const earnedMainnet: Record<Currency, bigint> = { QIE: 0n, QUSDC: 0n };
  let contracts = 0;
  let verified = 0;
  let checked = 0;
  let templateDeploys = 0;
  let sales = 0;
  let paidDeploys = 0;
  let tipsReceived = 0;
  let eventsAvailable = false;
  let bestRank: Model["bestRank"] = null;
  let txCount: number | null = null;
  let tokenTransfers: number | null = null;
  const walletActivity: number[] = [];
  const incomingMarketTimes: number[] = [];
  const networksActive = new Set<string>();

  for (const c of data.chains) {
    const explorer = devstationExplorerBase(slugForChainId(c.chainId));
    if (c.deployments) {
      contracts += c.deployments.total;
      verified += c.deployments.verified;
      checked += c.deployments.checked;
      templateDeploys += c.deployments.templateDeploys ?? 0;
      if (c.deployments.total > 0) networksActive.add(c.name);
      for (const d of c.deployments.items) {
        deployments.push({ ...d, chainId: c.chainId, chain: c.name });
        events.push({
          kind: "deploy",
          at: d.deployedAt,
          title: `Deployed ${d.projectName || "a contract"}`,
          detail: `${d.templateId || "custom"} · ${c.name}`,
          href: `${explorer}/address/${d.contractAddress}`,
          external: true,
          chainId: c.chainId,
          key: d.txHash,
        });
      }
    }
    if (c.marketplace) {
      const m = c.marketplace;
      sales += m.sales;
      paidDeploys += m.paidDeploys;
      tipsReceived += m.tipsReceived;
      eventsAvailable = eventsAvailable || m.eventsAvailable;
      if (m.listings.length > 0) networksActive.add(c.name);
      if (!c.testnet) {
        earnedMainnet.QIE += BigInt(m.earned.QIE) + BigInt(m.tips.QIE);
        earnedMainnet.QUSDC += BigInt(m.earned.QUSDC) + BigInt(m.tips.QUSDC);
      }
      const nameOf = new Map(m.listings.map((l) => [l.id, l.name]));
      for (const l of m.listings) listings.push({ ...l, chainId: c.chainId, testnet: c.testnet });
      for (const e of m.events) {
        const listing = nameOf.get(e.listingId) ?? `listing #${e.listingId}`;
        const amount =
          BigInt(e.amount) > 0n
            ? `${formatAmount(BigInt(e.amount), e.currency)} ${e.currency}`
            : "";
        const net = c.testnet ? ` · ${c.name}` : "";
        const href = `/launchkit/marketplace/${listingId("market", e.listingId)}`;
        if (e.type === "sale" || e.type === "deploy-sale" || e.type === "tip")
          incomingMarketTimes.push(e.at);
        events.push({
          kind: e.type,
          at: e.at,
          title:
            e.type === "listing"
              ? `Listed ${listing}`
              : e.type === "sale"
                ? `Sold ${listing}`
                : e.type === "deploy-sale"
                  ? `${listing} deployed by a buyer`
                  : e.type === "tip"
                    ? `Tipped on ${listing}`
                    : `Bought ${listing}`,
          detail:
            [amount, e.type === "listing" ? "" : shortAddr(e.counterparty)]
              .filter(Boolean)
              .join(" · ") + net,
          href,
          chainId: c.chainId,
          key: `${e.txHash}:${e.type}`,
        });
      }
    }
    if (c.labels) {
      for (const l of c.labels) {
        labels.push({ ...l, chainId: c.chainId });
        events.push({
          kind: "label",
          at: l.at,
          title: `Labeled ${l.name}`,
          detail: `${l.category} · ${c.name}`,
          href: `${explorer}/address/${l.address}`,
          external: true,
          key: l.txHash,
        });
      }
    }
    if (c.rank && (!bestRank || (!c.testnet && c.rank.rank <= bestRank.rank))) {
      bestRank = { rank: c.rank.rank, chain: c.name };
    }
    if (c.wallet) {
      if (!c.testnet || txCount === null) {
        txCount = (txCount ?? 0) + (c.wallet.txCount ?? 0);
        tokenTransfers = (tokenTransfers ?? 0) + (c.wallet.tokenTransfers ?? 0);
      }
      walletActivity.push(...c.wallet.activity);
    }
  }

  return {
    contracts,
    verified,
    checked,
    templatesUsed: new Set(deployments.map((d) => d.templateId).filter(Boolean)).size,
    templateDeploys,
    networksActive: [...networksActive],
    deployments: deployments.sort((a, b) => b.deployedAt - a.deployedAt),
    listings,
    sales,
    paidDeploys,
    tipsReceived,
    earnedMainnet,
    eventsAvailable,
    labels: labels.sort((a, b) => b.at - a.at),
    bestRank,
    txCount,
    tokenTransfers,
    walletActivity,
    incomingMarketTimes,
    events,
  };
}

function formatEarned(e: Record<Currency, bigint>) {
  const parts = [];
  if (e.QUSDC > 0n) parts.push(`${formatAmount(e.QUSDC, "QUSDC")} QUSDC`);
  if (e.QIE > 0n) parts.push(`${formatAmount(e.QIE, "QIE")} QIE`);
  return parts.length ? parts.join(" + ") : "0";
}

function cell(n: number | undefined) {
  return n === undefined ? <span className="text-meta">-</span> : n;
}

// --------------------------------------------------------------- sections

function ContractsSection({ model, loading }: { model: Model | null; loading: boolean }) {
  const [network, setNetwork] = useState<string>("all");
  const rows = (model?.deployments ?? []).filter((d) => network === "all" || d.chain === network);
  const networks = [...new Set((model?.deployments ?? []).map((d) => d.chain))];
  return (
    <Card
      title="Contracts"
      icon={Rocket}
      action={
        networks.length > 1 ? (
          <div className="flex gap-1">
            {["all", ...networks].map((n) => (
              <button
                key={n}
                onClick={() => setNetwork(n)}
                className={cn(
                  "rounded border px-2 py-0.5 font-mono text-[10px]",
                  network === n
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-meta hover:text-foreground",
                )}
              >
                {n === "all" ? "All" : n}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      {loading || !model ? (
        <Skeleton className="h-40" />
      ) : rows.length === 0 ? (
        <Empty>
          No contracts deployed yet.{" "}
          <Link
            to="/launchkit/marketplace"
            search={{ kind: "template" }}
            className="text-primary hover:underline"
          >
            Pick a template
          </Link>
          .
        </Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left font-mono text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-meta">
              <tr className="border-b border-border">
                <th className="py-2 pr-3 font-normal">Project</th>
                <th className="py-2 pr-3 font-normal">Template</th>
                <th className="py-2 pr-3 font-normal">Network</th>
                <th className="py-2 pr-3 font-normal">Contract</th>
                <th className="py-2 pr-3 font-normal">Source</th>
                <th className="py-2 text-right font-normal">Deployed</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 50).map((d) => (
                <tr
                  key={`${d.chainId}-${d.txHash}`}
                  className="border-b border-border last:border-0"
                >
                  <td className="max-w-[220px] truncate py-2 pr-3 text-foreground">
                    {d.projectName || "-"}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{d.templateId || "custom"}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{d.chain}</td>
                  <td className="py-2 pr-3">
                    <Link
                      to="/explorer/$network/address/$hash"
                      params={{ network: slugForChainId(d.chainId), hash: d.contractAddress }}
                      className="text-muted-foreground hover:text-primary"
                    >
                      {shortAddr(d.contractAddress)}
                    </Link>
                  </td>
                  <td className="py-2 pr-3">
                    {d.verified === true ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <ShieldCheck className="h-3 w-3" /> verified
                      </span>
                    ) : d.verified === false ? (
                      <span className="text-warning">unverified</span>
                    ) : (
                      <span className="text-meta">not checked</span>
                    )}
                  </td>
                  <td className="py-2 text-right text-meta">
                    {d.deployedAt > 0 ? timeAgo(new Date(d.deployedAt).toISOString()) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 50 && (
            <p className="mt-2 font-mono text-[10px] text-meta">
              Showing the latest 50 of {rows.length}.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function MarketplaceSection({
  data,
  owner,
}: {
  data: BuilderOverview | undefined;
  owner: boolean;
}) {
  const markets = (data?.chains ?? []).filter((c) => c.marketplace);
  const listings = markets.flatMap((c) =>
    c.marketplace!.listings.map((l) => ({ ...l, chain: c.name, testnet: c.testnet })),
  );
  const pendingAny = markets.some(
    (c) => BigInt(c.marketplace!.pending.QIE) > 0n || BigInt(c.marketplace!.pending.QUSDC) > 0n,
  );

  return (
    <Card
      title="Marketplace"
      icon={Store}
      action={
        owner ? (
          <div className="flex gap-2">
            <Link
              to="/launchkit/marketplace/sell"
              className="font-mono text-[10px] text-primary hover:underline"
            >
              New listing →
            </Link>
            <Link
              to="/launchkit/marketplace/creator"
              className="font-mono text-[10px] text-primary hover:underline"
            >
              Earnings →
            </Link>
          </div>
        ) : null
      }
    >
      {!data ? (
        <Skeleton className="h-32" />
      ) : markets.length === 0 ? (
        <Empty>The marketplace could not be read right now.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {markets.map((c) => {
              const m = c.marketplace!;
              return (
                <div
                  key={c.chainId}
                  className="rounded-lg border border-border bg-background/50 p-3"
                >
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-meta">
                    <span>{c.name}</span>
                    {c.testnet && (
                      <span className="rounded bg-surface-2 px-1 text-[9px]">test</span>
                    )}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
                    <Mini label="Earned" value={amounts(m.earned)} />
                    <Mini label="Tips" value={amounts(m.tips)} />
                    <Mini label="To withdraw" value={amounts(m.pending)} highlight={owner} />
                    <Mini label="Bought" value={String(m.purchases)} />
                  </div>
                </div>
              );
            })}
          </div>

          {owner && pendingAny && (
            <Link
              to="/launchkit/marketplace/creator"
              className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
            >
              <Wallet className="h-3.5 w-3.5" /> Withdraw your earnings
            </Link>
          )}

          {listings.length === 0 ? (
            <Empty>
              {owner ? (
                <>
                  Nothing listed yet.{" "}
                  <Link to="/launchkit/marketplace/sell" className="text-primary hover:underline">
                    Sell a template, app, skill or UI kit
                  </Link>{" "}
                  and keep 95% of every sale.
                </>
              ) : (
                "Nothing listed yet."
              )}
            </Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-left font-mono text-xs">
                <thead className="text-[10px] uppercase tracking-wider text-meta">
                  <tr className="border-b border-border">
                    <th className="py-2 pr-3 font-normal">Listing</th>
                    <th className="py-2 pr-3 font-normal">Kind</th>
                    <th className="py-2 pr-3 font-normal">Price</th>
                    <th className="py-2 pr-3 text-right font-normal">Sales</th>
                    <th className="py-2 pr-3 font-normal">Network</th>
                    <th className="py-2 text-right font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map((l) => (
                    <tr key={`${l.chain}-${l.id}`} className="border-b border-border last:border-0">
                      <td className="max-w-[240px] truncate py-2 pr-3">
                        <Link
                          to="/launchkit/marketplace/$listingId"
                          params={{ listingId: listingId("market", l.id) }}
                          className="text-foreground hover:text-primary"
                        >
                          {l.name}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {kindInfo(kindFromCode(l.kind)).singular}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">
                        {formatPrice(BigInt(l.price), cur(l.currency))}
                        {l.model === 1 && BigInt(l.price) > 0n ? " / deploy" : ""}
                      </td>
                      <td className="py-2 pr-3 text-right text-foreground">
                        {l.sales + l.deploys}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{l.chain}</td>
                      <td className="py-2 text-right">
                        {l.hidden ? (
                          <span className="text-danger">taken down</span>
                        ) : !l.active ? (
                          <span className="text-meta">unlisted</span>
                        ) : l.featuredUntil > Date.now() ? (
                          <span className="text-primary">featured</span>
                        ) : (
                          <span className="text-success">live</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function LabelsList({ model }: { model: Model | null }) {
  if (!model) return <Skeleton className="h-24" />;
  if (model.labels.length === 0) {
    return (
      <Empty>
        No contracts labeled yet.{" "}
        <Link to="/routebook/labels" className="text-primary hover:underline">
          Name a contract
        </Link>{" "}
        to help everyone read the chain.
      </Empty>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {model.labels.slice(0, 10).map((l) => (
        <li
          key={`${l.chainId}-${l.txHash}`}
          className="flex items-center justify-between gap-3 py-2"
        >
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-foreground">{l.name}</div>
            <div className="font-mono text-[10px] text-meta">
              {l.category} · {shortAddr(l.address)}
            </div>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-meta">
            {l.at ? timeAgo(new Date(l.at).toISOString()) : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function amounts(a: { QIE: string; QUSDC: string }) {
  const parts = [];
  if (BigInt(a.QUSDC) > 0n) parts.push(`${formatAmount(BigInt(a.QUSDC), "QUSDC")} QUSDC`);
  if (BigInt(a.QIE) > 0n) parts.push(`${formatAmount(BigInt(a.QIE), "QIE")} QIE`);
  return parts.length ? parts.join(" + ") : "0";
}

// ------------------------------------------------------------- building blocks

const ACHIEVEMENT_ICON: Record<
  Achievement["group"],
  React.ComponentType<{ className?: string }>
> = {
  ship: Rocket,
  quality: ShieldCheck,
  market: Coins,
  community: Tags,
  identity: BadgeCheck,
};

function Achievements({ list }: { list: Achievement[] }) {
  const sorted = [...list].sort(
    (a, b) => Number(b.earned) - Number(a.earned) || b.current / b.target - a.current / a.target,
  );
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
      {sorted.map((a) => {
        const Icon = a.earned ? ACHIEVEMENT_ICON[a.group] : Lock;
        const pct = Math.min(100, Math.round((a.current / a.target) * 100));
        return (
          <div
            key={a.id}
            className={cn(
              "rounded-lg border p-2.5",
              a.earned ? "border-primary/40 bg-primary/5" : "border-border bg-background/40",
            )}
            title={a.description}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                  a.earned ? "bg-primary/20 text-primary" : "bg-surface-2 text-meta",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <div
                  className={cn(
                    "font-mono text-[11px] font-bold leading-tight",
                    a.earned ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {a.title}
                </div>
                <div className="line-clamp-2 font-mono text-[10px] text-meta">{a.description}</div>
              </div>
            </div>
            {!a.earned && (
              <div className="mt-2">
                <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-primary/60" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-0.5 text-right font-mono text-[9px] text-meta">
                  {Math.min(a.current, a.target)} / {a.target}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const TIMELINE_ICON: Record<ActivityEvent["kind"], React.ComponentType<{ className?: string }>> = {
  deploy: Rocket,
  listing: Store,
  sale: ShoppingBag,
  "deploy-sale": ShoppingBag,
  tip: Gift,
  purchase: ShoppingBag,
  label: Tags,
  app: AppWindow,
  tx: Layers,
};

function TimelineItem({ event }: { event: ActivityEvent }) {
  const Icon = TIMELINE_ICON[event.kind];
  const income = event.kind === "sale" || event.kind === "deploy-sale" || event.kind === "tip";
  const title = event.href ? (
    event.external ? (
      <a href={event.href} target="_blank" rel="noreferrer" className="hover:text-primary">
        {event.title}
      </a>
    ) : (
      <a href={event.href} className="hover:text-primary">
        {event.title}
      </a>
    )
  ) : (
    event.title
  );
  return (
    <li className="relative">
      <span
        className={cn(
          "absolute -left-[27px] top-0.5 flex h-4 w-4 items-center justify-center rounded-full border bg-surface",
          income ? "border-success/60 text-success" : "border-border text-meta",
        )}
      >
        <Icon className="h-2.5 w-2.5" />
      </span>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="font-mono text-xs text-foreground">{title}</span>
        <span className="font-mono text-[10px] text-meta">
          {timeAgo(new Date(event.at).toISOString())}
        </span>
      </div>
      {event.detail && (
        <div className="font-mono text-[10px] text-muted-foreground">{event.detail}</div>
      )}
    </li>
  );
}

function Card({
  title,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-foreground">
          <Icon className="h-3.5 w-3.5 text-primary" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({
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
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3 shrink-0 text-primary/80" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 truncate font-mono text-lg font-bold text-foreground">{value}</div>
      {sub && <div className="truncate font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Mini({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider text-meta">{label}</div>
      <div
        className={cn("truncate", highlight && value !== "0" ? "text-primary" : "text-foreground")}
      >
        {value}
      </div>
    </div>
  );
}

function HeroFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] uppercase tracking-wider text-meta">{label}</dt>
      <dd className="truncate text-foreground">{value}</dd>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center font-mono text-xs text-meta">
      {children}
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-xl border border-border bg-surface", className)} />
  );
}

function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 hover:text-primary"
      title={address}
    >
      {shortAddr(address)}
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

function ShareProfile({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(`${window.location.origin}/dev/${address}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center gap-1 hover:text-primary"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <ExternalLink className="h-3 w-3" />}
      {copied ? "Profile link copied" : "Share profile"}
    </button>
  );
}

// Re-exported for pages that show a builder inline.
export { BuilderName };
