import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  Boxes,
  Code2,
  LayoutDashboard,
  RefreshCw,
  Rocket,
  Search,
  ShieldCheck,
  Store,
  TriangleAlert,
  Users,
  Wallet,
} from "lucide-react";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { BuilderName } from "@/components/builder/BuilderName";
import { useProjects } from "@/lib/data/projects";
import { TEMPLATES } from "@/lib/data/templates";
import { DEFAULT_GAS_GWEI, SUPPORTED_CHAINS, chainConfig, qieTestnet } from "@/lib/chains";
import { formatGas } from "@/lib/format-gas";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useCombinedDeployStats } from "@/hooks/useProjectRegistry";
import { useBuilderOverview } from "@/hooks/useBuilderOverview";
import { useMarketplace } from "@/hooks/useMarketplace";
import { getAllDeploymentsCombined, getNetworkStatus } from "@/lib/api/chain.functions";
import { isContractConfigured, projectRegistryAddress } from "@/lib/contracts";
import { formatPrice, listingId } from "@/lib/marketplace/listing";
import { slugForChainId } from "@/lib/explorer/network";
import { shortAddr } from "@/lib/explorer/format";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/utils";

// The console's front page: the state of DevStation across every network, and
// the connected builder's place in it.
//
// Nothing is shown until it has actually been read. A number that is still
// loading renders as a placeholder, not as 0 or "-", because both of those read
// as real answers. A network that could not be read is named, rather than
// silently leaving its share out of a total.

export const Route = createFileRoute("/overview")({
  head: () => ({
    meta: [
      { title: "Overview: DevStation" },
      {
        name: "description",
        content:
          "DevStation across every network: deployments, builders, the marketplace and network health, with your own work alongside.",
      },
    ],
  }),
  component: Overview,
});

interface Row {
  key: string;
  name: string;
  template: string;
  chainId: number;
  address: string;
  txHash: string;
  deployedAt: number;
  source: "verified" | "unverified" | "unchecked" | "local";
}

const CHAIN_TONE: Record<number, string> = {
  1990: "bg-primary",
  1983: "bg-primary/50",
  677: "bg-info",
  968: "bg-info/50",
};

const KIND_LABEL: Record<string, string> = {
  template: "Template",
  app: "App",
  skill: "Skill",
  "ui-kit": "UI kit",
};

function templateName(id: string): string {
  if (!id) return "Custom contract";
  return TEMPLATES.find((t) => t.id === id)?.name ?? id;
}

function Overview() {
  const { address, isConnected } = useAccount();
  const { chainId } = useActiveChain();

  const stats = useCombinedDeployStats();
  const builder = useBuilderOverview(address);
  const market = useMarketplace();
  const localProjects = useProjects((s) => s.projects);
  const localHydrated = useProjects((s) => s.hydrated);

  const registries = useMemo(
    () =>
      SUPPORTED_CHAINS.map((c) => ({
        chainId: c.id,
        registry: projectRegistryAddress(c.id),
      })).filter((c) => isContractConfigured(c.registry)),
    [],
  );

  const feed = useQuery({
    queryKey: ["ecosystem-feed", registries.map((r) => `${r.chainId}:${r.registry}`).join(",")],
    queryFn: () => getAllDeploymentsCombined({ data: { chains: registries } }),
    enabled: registries.length > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const statuses = useQueries({
    queries: SUPPORTED_CHAINS.map((c) => ({
      queryKey: ["network-status", c.id],
      queryFn: () => getNetworkStatus({ data: { chainId: c.id } }),
      refetchInterval: 15_000,
      staleTime: 10_000,
    })),
  });

  const [quickHash, setQuickHash] = useState("");
  const [inspections, setInspections] = useState<string[] | null>(null);
  useEffect(() => setInspections(storage.loadInspections()), []);

  // Your deployments: the on-chain record on every network, plus anything this
  // browser deployed that has not reached a registry yet.
  const rows = useMemo<Row[] | null>(() => {
    if (!address) return [];
    if (builder.isLoading || !localHydrated) return null;
    const onChain: Row[] = [];
    const seen = new Set<string>();
    for (const c of builder.data?.chains ?? []) {
      for (const d of c.deployments?.items ?? []) {
        seen.add(d.txHash.toLowerCase());
        onChain.push({
          key: `${c.chainId}:${d.txHash}`,
          name: d.projectName || "Untitled",
          template: d.templateId || "custom",
          chainId: c.chainId,
          address: d.contractAddress,
          txHash: d.txHash,
          deployedAt: d.deployedAt,
          source:
            d.verified === true ? "verified" : d.verified === false ? "unverified" : "unchecked",
        });
      }
    }
    const local: Row[] = localProjects
      .filter(
        (p) =>
          (!p.deployer || p.deployer.toLowerCase() === address.toLowerCase()) &&
          !seen.has(p.txHash.toLowerCase()),
      )
      .map((p) => ({
        key: `local:${p.id}`,
        name: p.name,
        template: p.templateName || p.templateId,
        chainId: p.chainId ?? qieTestnet.id,
        address: p.address,
        txHash: p.txHash,
        deployedAt: p.deployedAt,
        source: "local" as const,
      }));
    return [...onChain, ...local].sort((a, b) => b.deployedAt - a.deployedAt);
  }, [address, builder.isLoading, builder.data, localHydrated, localProjects]);

  const latest = useMemo(
    () =>
      (feed.data?.deployments ?? [])
        .flatMap((d) => (typeof d.chainId === "number" ? [{ ...d, chainId: d.chainId }] : []))
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 8),
    [feed.data],
  );

  const liveListings = useMemo(
    () => market.summaries.filter((s) => s.active && !s.hidden),
    [market.summaries],
  );
  const highlights = useMemo(
    () =>
      [...liveListings]
        .sort((a, b) => b.sales + b.deploys - (a.sales + a.deploys) || b.id - a.id)
        .slice(0, 4),
    [liveListings],
  );
  const totalSales = liveListings.reduce((n, s) => n + s.sales + s.deploys, 0);

  const unreadChains = stats.chains.filter((c) => c.contracts === null || c.users === null);
  const statusesLoading = statuses.some((s) => s.isLoading);
  const onlineCount = statuses.filter((s) => s.data?.status === "online").length;
  const selectedIndex = SUPPORTED_CHAINS.findIndex((c) => c.id === chainId);
  const selectedStatus = selectedIndex >= 0 ? statuses[selectedIndex]?.data : undefined;

  const refreshAll = () => {
    void stats.refetch();
    void builder.refetch();
    void feed.refetch();
    void market.refetchSummaries();
    statuses.forEach((s) => void s.refetch());
  };
  const refreshing =
    stats.fetching || builder.isFetching || feed.isFetching || statuses.some((s) => s.isFetching);

  const maxChainContracts = Math.max(1, ...stats.chains.map((c) => c.contracts ?? 0));
  const verifiedCount = rows?.filter((r) => r.source === "verified").length ?? 0;
  const networksUsed = rows ? new Set(rows.map((r) => r.chainId)).size : 0;

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border px-5 pb-6 pt-8 sm:px-8 lg:px-12">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary">
              DevStation console
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-foreground">Overview</h1>
            <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
              DevStation across every network, read live from chain, with your own work alongside.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={refreshAll}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
              {refreshing ? "Refreshing" : "Refresh"}
            </button>
            <Link
              to="/launchkit/deploy"
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 font-mono text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
            >
              <Rocket className="h-3.5 w-3.5" /> Deploy a contract
            </Link>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-5 py-6 sm:px-8 lg:px-12">
        {/* KPIs */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            icon={Boxes}
            label="Contracts deployed"
            loading={stats.loading}
            value={
              !stats.onChain
                ? "n/a"
                : stats.error || stats.totalDeployments === null
                  ? "unavailable"
                  : stats.totalDeployments.toLocaleString()
            }
          >
            {stats.onChain && !stats.error && stats.chains.length > 0 ? (
              <div className="space-y-1.5">
                {stats.chains.map((c) => (
                  <div key={c.chainId} className="flex items-center gap-2 font-mono text-[10px]">
                    <span className="w-24 truncate text-meta">{chainConfig(c.chainId).name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className={cn(
                          "block h-full rounded-full",
                          CHAIN_TONE[c.chainId] ?? "bg-primary",
                        )}
                        style={{ width: `${((c.contracts ?? 0) / maxChainContracts) * 100}%` }}
                      />
                    </span>
                    <span className="w-8 text-right text-muted-foreground">
                      {c.contracts === null ? "?" : c.contracts.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {!stats.onChain ? "No registry configured" : "Across every network"}
              </p>
            )}
          </Kpi>

          <Kpi
            icon={Users}
            label="Builders"
            loading={stats.loading}
            value={
              !stats.onChain
                ? "n/a"
                : stats.error
                  ? "unavailable"
                  : stats.uniqueDeployers.toLocaleString()
            }
          >
            <p className="text-xs text-muted-foreground">
              Distinct wallets that recorded a deployment, on{" "}
              {stats.chains.length || SUPPORTED_CHAINS.length} networks.
            </p>
            <Link
              to="/leaderboard"
              className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
            >
              Leaderboard <ArrowRight className="h-3 w-3" />
            </Link>
          </Kpi>

          <Kpi
            icon={Activity}
            label="Networks online"
            loading={statusesLoading}
            value={`${onlineCount}/${SUPPORTED_CHAINS.length}`}
          >
            <div className="flex gap-1">
              {SUPPORTED_CHAINS.map((c, i) => (
                <span
                  key={c.id}
                  title={`${c.name}: ${statuses[i]?.data?.status === "online" ? "online" : "unreachable"}`}
                  className={cn(
                    "h-1.5 flex-1 rounded-full",
                    statuses[i]?.data?.status === "online" ? "bg-success" : "bg-danger",
                  )}
                />
              ))}
            </div>
            <p className="mt-2 truncate text-xs text-muted-foreground">
              {selectedStatus?.status === "online"
                ? `${chainConfig(chainId).name} at block #${selectedStatus.blockNumber.toLocaleString()}`
                : `${chainConfig(chainId).name} is unreachable`}
            </p>
          </Kpi>

          <Kpi
            icon={Store}
            label="Marketplace listings"
            loading={market.configured && market.loading}
            value={market.configured ? liveListings.length.toLocaleString() : "QIE Mainnet"}
          >
            <p className="text-xs text-muted-foreground">
              {market.configured
                ? `${totalSales.toLocaleString()} sales and paid deploys · ${TEMPLATES.length} official templates`
                : "Community listings are on QIE Mainnet. Switch network to see them."}
            </p>
            <Link
              to="/launchkit/marketplace"
              className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
            >
              Browse <ArrowRight className="h-3 w-3" />
            </Link>
          </Kpi>
        </div>

        {!stats.loading && stats.onChain && (unreadChains.length > 0 || stats.error) && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 font-mono text-[11px] text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {stats.error
                ? "Ecosystem totals could not be read right now."
                : `Partial totals: ${unreadChains.map((c) => chainConfig(c.chainId).name).join(", ")} could not be fully read, so ${unreadChains.length === 1 ? "its" : "their"} numbers are missing above.`}
            </span>
          </div>
        )}

        {/* Feed + workspace */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Latest deployments"
            subtitle="Recorded through DevStation, on every network"
            action={
              <Link to="/analytics" className="font-mono text-[11px] text-primary hover:underline">
                Analytics →
              </Link>
            }
          >
            {registries.length === 0 ? (
              <Empty>No registry is configured.</Empty>
            ) : feed.isLoading ? (
              <SkeletonRows count={6} />
            ) : feed.isError ? (
              <Empty>The latest deployments could not be read right now.</Empty>
            ) : latest.length === 0 ? (
              <Empty>No deployments recorded yet.</Empty>
            ) : (
              <ul className="divide-y divide-border">
                {latest.map((d) => (
                  <li
                    key={`${d.chainId}:${d.txHash}`}
                    className="flex items-center gap-3 px-4 py-3 transition hover:bg-surface-2/60"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background",
                      )}
                    >
                      <Boxes className="h-4 w-4 text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {d.projectName || "Untitled"}
                        </span>
                        <span className="hidden shrink-0 rounded border border-border px-1.5 py-px font-mono text-[10px] text-meta sm:inline">
                          {templateName(d.templateId)}
                        </span>
                      </div>
                      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
                            CHAIN_TONE[d.chainId] ?? "bg-primary",
                          )}
                        />
                        <span className="shrink-0">{chainConfig(d.chainId).name}</span>
                        <span className="text-meta">·</span>
                        <BuilderName address={d.deployer} className="min-w-0 hover:text-primary" />
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-[11px] text-meta">
                        {d.timestamp > 0
                          ? formatDistanceToNow(d.timestamp * 1000, { addSuffix: true })
                          : "-"}
                      </div>
                      <Link
                        to="/explorer/$network/address/$hash"
                        params={{ network: slugForChainId(d.chainId), hash: d.contractAddress }}
                        className="mt-0.5 inline-flex items-center gap-0.5 font-mono text-[11px] text-primary hover:underline"
                        title={d.contractAddress}
                      >
                        {shortAddr(d.contractAddress)} <ArrowUpRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Your workspace">
            {!isConnected || !address ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-border bg-background">
                  <Wallet className="h-5 w-5 text-meta" />
                </span>
                <p className="mt-3 text-sm font-medium text-foreground">Connect a wallet</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">
                  Your deployments, apps, earnings and QIE ID appear here, read from chain for the
                  connected wallet.
                </p>
              </div>
            ) : (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <BuilderName
                    address={address}
                    avatar
                    link={false}
                    className="min-w-0 text-base font-semibold text-foreground"
                  />
                </div>
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <MiniStat label="Contracts" value={rows === null ? null : rows.length} />
                  <MiniStat label="Networks" value={rows === null ? null : networksUsed} />
                  <MiniStat label="Verified" value={rows === null ? null : verifiedCount} />
                </div>
                <p className="mt-3 font-mono text-[11px] text-meta">
                  {rows === null
                    ? "Reading your deployments…"
                    : rows.length > 0 && rows[0].deployedAt > 0
                      ? `Last deployed ${formatDistanceToNow(rows[0].deployedAt, { addSuffix: true })}`
                      : "Nothing deployed yet"}
                </p>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <Link
                    to="/activity"
                    className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 font-mono text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
                  >
                    <LayoutDashboard className="h-3.5 w-3.5" /> Dashboard
                  </Link>
                  <Link
                    to="/dev/$address"
                    params={{ address }}
                    className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    Public profile
                  </Link>
                </div>
              </div>
            )}
          </Panel>
        </div>

        {/* Your deployments + quick actions */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Your deployments"
            action={
              <Link to="/activity" className="font-mono text-[11px] text-primary hover:underline">
                Dashboard →
              </Link>
            }
          >
            {!isConnected ? (
              <Empty>Connect a wallet to see what you have deployed.</Empty>
            ) : rows === null ? (
              <SkeletonRows />
            ) : builder.isError && rows.length === 0 ? (
              <Empty>Your deployments could not be read right now.</Empty>
            ) : rows.length === 0 ? (
              <Empty>
                No deployments yet.{" "}
                <Link to="/launchkit/deploy" className="text-primary hover:underline">
                  Deploy your first contract
                </Link>
                .
              </Empty>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] font-mono text-xs">
                  <thead className="text-meta">
                    <tr className="border-b border-border">
                      <th className="px-4 py-2 text-left font-normal">Name</th>
                      <th className="px-4 py-2 text-left font-normal">Template</th>
                      <th className="px-4 py-2 text-left font-normal">Network</th>
                      <th className="px-4 py-2 text-left font-normal">Deployed</th>
                      <th className="px-4 py-2 text-left font-normal">Source</th>
                      <th className="px-4 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 6).map((r) => (
                      <tr key={r.key} className="border-b border-border last:border-0">
                        <td className="max-w-[180px] truncate px-4 py-2.5 text-foreground">
                          {r.name}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {templateName(r.template)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {chainConfig(r.chainId).name}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {r.deployedAt > 0
                            ? formatDistanceToNow(r.deployedAt, { addSuffix: true })
                            : "-"}
                        </td>
                        <td className="px-4 py-2.5">
                          <SourceTag source={r.source} />
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Link
                            to="/explorer/$network/address/$hash"
                            params={{ network: slugForChainId(r.chainId), hash: r.address }}
                            className="text-meta hover:text-primary"
                            title={shortAddr(r.address)}
                          >
                            <ArrowRight className="inline h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > 6 && (
                  <div className="border-t border-border px-4 py-2 text-right">
                    <Link
                      to="/activity"
                      className="font-mono text-[11px] text-primary hover:underline"
                    >
                      All {rows.length} on your dashboard →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Quick actions">
            <div className="grid grid-cols-2 gap-2 p-3">
              <Action to="/launchkit/deploy" icon={Rocket} label="Deploy" hint="From a template" />
              <Action to="/launchkit/editor" icon={Code2} label="Editor" hint="Write Solidity" />
              <Action
                to="/launchkit/coding-agent"
                icon={Bot}
                label="Coding Agent"
                hint="Build an app"
              />
              <Action
                to="/launchkit/marketplace/sell"
                icon={Store}
                label="Sell"
                hint="List your work"
              />
            </div>
            <div className="border-t border-border p-3">
              <label className="font-mono text-[10px] uppercase tracking-wider text-meta">
                Inspect a transaction
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  value={quickHash}
                  onChange={(e) => setQuickHash(e.target.value)}
                  placeholder="0x… transaction hash"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
                {/^0x[0-9a-fA-F]{64}$/.test(quickHash.trim()) ? (
                  <Link
                    to="/routebook/$txHash"
                    params={{ txHash: quickHash.trim() }}
                    className="inline-flex items-center rounded-md border border-primary px-3 text-primary hover:bg-primary/10"
                    aria-label="Decode transaction"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <button
                    disabled
                    className="inline-flex items-center rounded-md border border-border px-3 text-meta opacity-50"
                    aria-label="Decode transaction"
                  >
                    <Search className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {quickHash.trim() && !/^0x[0-9a-fA-F]{64}$/.test(quickHash.trim()) && (
                <p className="mt-1.5 text-[10px] text-meta">
                  A transaction hash is 0x followed by 64 hex characters.
                </p>
              )}
              {inspections && inspections.length > 0 && (
                <ul className="mt-3 space-y-1">
                  {inspections.slice(0, 3).map((hash) => (
                    <li key={hash} className="flex items-center justify-between gap-2">
                      <TxHashChip hash={hash} />
                      <Link
                        to="/routebook/$txHash"
                        params={{ txHash: hash }}
                        className="font-mono text-[11px] text-primary hover:underline"
                      >
                        Re-open
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Panel>
        </div>

        {/* Marketplace + network health */}
        <div className="grid gap-6 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Marketplace highlights"
            subtitle="Most bought and deployed listings"
            action={
              <Link
                to="/launchkit/marketplace"
                className="font-mono text-[11px] text-primary hover:underline"
              >
                Marketplace →
              </Link>
            }
          >
            {!market.configured ? (
              <Empty>
                Community listings live on QIE Mainnet. Switch network in the sidebar to see them,
                or{" "}
                <Link to="/launchkit/marketplace" className="text-primary hover:underline">
                  browse the official templates
                </Link>
                .
              </Empty>
            ) : market.loading ? (
              <SkeletonRows count={3} />
            ) : highlights.length === 0 ? (
              <Empty>
                Nothing listed yet.{" "}
                <Link to="/launchkit/marketplace/sell" className="text-primary hover:underline">
                  Be the first to sell
                </Link>
                .
              </Empty>
            ) : (
              <div className="grid gap-2 p-3 sm:grid-cols-2">
                {highlights.map((s) => (
                  <Link
                    key={s.id}
                    to="/launchkit/marketplace/$listingId"
                    params={{ listingId: listingId("market", s.id) }}
                    className="group rounded-md border border-border bg-background p-3 transition hover:border-primary/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                        {s.name}
                      </span>
                      {s.featuredUntil > Date.now() && (
                        <span className="shrink-0 rounded bg-primary/15 px-1.5 py-px font-mono text-[9px] uppercase text-primary">
                          Featured
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                      <span>{KIND_LABEL[s.kind] ?? s.kind}</span>
                      <span className="text-foreground">{formatPrice(s.price, s.currency)}</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-meta">
                      <BuilderName address={s.creator} link={false} className="min-w-0" />
                      <span className="shrink-0">
                        {(s.sales + s.deploys).toLocaleString()} sold
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Network status"
            action={
              <Link
                to="/explorer/$network"
                params={{ network: slugForChainId(chainId) }}
                className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
              >
                Explorer <ArrowRight className="h-3 w-3" />
              </Link>
            }
          >
            <ul className="divide-y divide-border">
              {SUPPORTED_CHAINS.map((c, i) => {
                const q = statuses[i];
                const net = q.data;
                const online = net?.status === "online";
                const gas = formatGas(
                  net && "gasPrice" in net ? (net as { gasPrice?: string }).gasPrice : undefined,
                  net?.gasPriceGwei ?? DEFAULT_GAS_GWEI,
                );
                return (
                  <li
                    key={c.id}
                    className={cn(
                      "flex items-center justify-between gap-3 px-4 py-3 font-mono text-xs",
                      c.id === chainId && "bg-primary/5",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          q.isLoading
                            ? "animate-pulse bg-meta"
                            : online
                              ? "bg-success"
                              : "bg-danger",
                        )}
                      />
                      <span className="truncate text-foreground">{c.name}</span>
                      {c.id === chainId && (
                        <span className="text-[9px] uppercase text-primary">selected</span>
                      )}
                    </span>
                    {q.isLoading ? (
                      <span className="h-3 w-24 animate-pulse rounded bg-surface-2" />
                    ) : online ? (
                      <span className="shrink-0 text-right text-muted-foreground">
                        #{net!.blockNumber.toLocaleString()}
                        <span className="block text-[10px] text-meta">{gas.text}</span>
                      </span>
                    ) : (
                      <span className="shrink-0 text-danger">unreachable</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </div>

        {stats.updatedAt > 0 && (
          <p className="flex items-center gap-1.5 font-mono text-[10px] text-meta">
            <ShieldCheck className="h-3 w-3" />
            Read from each network&apos;s ProjectRegistry, explorer and the Marketplace contract ·
            updated {formatDistanceToNow(stats.updatedAt, { addSuffix: true })}
          </p>
        )}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  loading,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-meta">{label}</span>
        <Icon className="h-4 w-4 text-meta" />
      </div>
      {loading ? (
        <>
          <div className="mt-3 h-8 w-24 animate-pulse rounded bg-surface-2" />
          <div className="mt-3 h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-surface-2" />
        </>
      ) : (
        <>
          <div className="mt-2 truncate text-3xl font-bold tracking-tight text-foreground">
            {value}
          </div>
          <div className="mt-3">{children}</div>
        </>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-md border border-border bg-background px-2 py-2 text-center">
      {value === null ? (
        <div className="mx-auto h-5 w-8 animate-pulse rounded bg-surface-2" />
      ) : (
        <div className="text-lg font-bold text-foreground">{value.toLocaleString()}</div>
      )}
      <div className="font-mono text-[9px] uppercase tracking-wider text-meta">{label}</div>
    </div>
  );
}

function Action({
  to,
  icon: Icon,
  label,
  hint,
}: {
  to:
    | "/launchkit/deploy"
    | "/launchkit/editor"
    | "/launchkit/coding-agent"
    | "/launchkit/marketplace/sell";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded-md border border-border bg-background p-3 transition hover:border-primary/50"
    >
      <Icon className="h-4 w-4 text-primary" />
      <div className="mt-2 text-xs font-semibold text-foreground group-hover:text-primary">
        {label}
      </div>
      <div className="font-mono text-[10px] text-meta">{hint}</div>
    </Link>
  );
}

function SourceTag({ source }: { source: Row["source"] }) {
  const style = {
    verified: "text-success",
    unverified: "text-warning",
    unchecked: "text-meta",
    local: "text-info",
  }[source];
  const label = {
    verified: "verified",
    unverified: "unverified",
    unchecked: "not checked",
    local: "this browser",
  }[source];
  return <span className={cn("text-[11px]", style)}>{label}</span>;
}

function Panel({
  title,
  subtitle,
  children,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {subtitle && <p className="truncate text-[11px] text-meta">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div>{children}</div>
    </section>
  );
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-8 animate-pulse rounded bg-surface-2" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-8 text-center font-mono text-xs leading-5 text-meta">{children}</div>;
}
