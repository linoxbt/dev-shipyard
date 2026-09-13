import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, RefreshCw, Rocket, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { useProjects } from "@/lib/data/projects";
import { TEMPLATES } from "@/lib/data/templates";
import { DEFAULT_GAS_GWEI, SUPPORTED_CHAINS, chainConfig, qieTestnet } from "@/lib/chains";
import { formatGas } from "@/lib/format-gas";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useCombinedDeployStats } from "@/hooks/useProjectRegistry";
import { useBuilderOverview } from "@/hooks/useBuilderOverview";
import { useMarketplace } from "@/hooks/useMarketplace";
import { getNetworkStatus } from "@/lib/api/chain.functions";
import { slugForChainId } from "@/lib/explorer/network";
import { shortAddr } from "@/lib/explorer/format";
import { storage } from "@/lib/storage";
import { cn } from "@/lib/utils";

// The workspace at a glance.
//
// Nothing is shown until it has actually been read. A number that is still
// loading renders as a placeholder, not as 0 or "-", because both of those read
// as real answers. A network that could not be read is named, rather than
// silently leaving its share out of a total.

export const Route = createFileRoute("/overview")({
  head: () => ({
    meta: [
      { title: "DevStation: Overview" },
      {
        name: "description",
        content: "Your QIE workspace: deployments, network status, and quick tools.",
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

function Overview() {
  const { address, isConnected } = useAccount();
  const { chainId } = useActiveChain();

  const stats = useCombinedDeployStats();
  const builder = useBuilderOverview(address);
  const market = useMarketplace();
  const localProjects = useProjects((s) => s.projects);
  const localHydrated = useProjects((s) => s.hydrated);

  const statuses = useQueries({
    queries: SUPPORTED_CHAINS.map((c) => ({
      queryKey: ["network-status", c.id],
      queryFn: () => getNetworkStatus({ data: { chainId: c.id } }),
      refetchInterval: 15_000,
      staleTime: 10_000,
    })),
  });

  const [quickTemplate, setQuickTemplate] = useState(TEMPLATES[0].id);
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

  const unreadChains = stats.chains.filter((c) => c.contracts === null || c.users === null);
  const liveListings = market.configured
    ? market.summaries.filter((s) => s.active && !s.hidden).length
    : null;

  const refreshAll = () => {
    void stats.refetch();
    void builder.refetch();
    void market.refetchSummaries();
    statuses.forEach((s) => void s.refetch());
  };
  const refreshing = stats.fetching || builder.isFetching || statuses.some((s) => s.isFetching);

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Overview"]}
        title="Overview"
        subtitle="Your QIE workspace: deployments, network status, and quick tools."
        action={
          <button
            onClick={refreshAll}
            disabled={refreshing}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-60"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        }
      />

      <div className="space-y-6 px-5 py-6 sm:px-8 lg:px-12">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Total deployments"
            loading={stats.loading}
            value={
              !stats.onChain
                ? "n/a"
                : stats.error || stats.totalDeployments === null
                  ? "unavailable"
                  : stats.totalDeployments.toLocaleString()
            }
            sub={
              !stats.onChain
                ? "no registry configured"
                : stats.chains
                    .filter((c) => c.contracts !== null)
                    .map((c) => `${chainConfig(c.chainId).name} ${c.contracts}`)
                    .join(" · ") || "all networks"
            }
          />
          <Stat
            label="Builders"
            loading={stats.loading}
            value={
              !stats.onChain
                ? "n/a"
                : stats.error
                  ? "unavailable"
                  : stats.uniqueDeployers.toLocaleString()
            }
            sub="unique wallets that deployed"
          />
          <Stat
            label="Your deployments"
            loading={!!address && rows === null}
            value={!isConnected ? "-" : rows ? rows.length.toLocaleString() : ""}
            sub={
              !isConnected
                ? "connect a wallet"
                : rows
                  ? `${new Set(rows.map((r) => r.chainId)).size} network${new Set(rows.map((r) => r.chainId)).size === 1 ? "" : "s"} · ${rows.filter((r) => r.source === "verified").length} verified`
                  : ""
            }
          />
          <Stat
            label="Templates"
            loading={market.configured && market.loading}
            value={TEMPLATES.length.toLocaleString()}
            sub={
              liveListings === null
                ? "official, free"
                : `official · +${liveListings} marketplace listing${liveListings === 1 ? "" : "s"}`
            }
          />
        </div>

        {!stats.loading && stats.onChain && (unreadChains.length > 0 || stats.error) && (
          <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 px-3 py-2 font-mono text-[11px] text-warning">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {stats.error
                ? "Ecosystem totals could not be read right now."
                : `Partial totals: ${unreadChains.map((c) => chainConfig(c.chainId).name).join(", ")} could not be fully read, so ${unreadChains.length === 1 ? "its" : "their"} numbers are missing above.`}
            </span>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Left: activity */}
          <div className="space-y-6 lg:col-span-3">
            <Panel
              title="Your deployments"
              action={
                <Link to="/activity" className="font-mono text-xs text-primary hover:underline">
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
                  <Link
                    to="/launchkit/marketplace"
                    search={{ kind: "template" }}
                    className="text-primary hover:underline"
                  >
                    Start with a template
                  </Link>
                  .
                </Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] font-mono text-xs">
                    <thead className="text-meta">
                      <tr className="border-b border-border">
                        <th className="px-3 py-2 text-left font-normal">Name</th>
                        <th className="px-3 py-2 text-left font-normal">Template</th>
                        <th className="px-3 py-2 text-left font-normal">Network</th>
                        <th className="px-3 py-2 text-left font-normal">Deployed</th>
                        <th className="px-3 py-2 text-left font-normal">Source</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.slice(0, 6).map((r) => (
                        <tr key={r.key} className="border-b border-border last:border-0">
                          <td className="max-w-[180px] truncate px-3 py-2 text-foreground">
                            {r.name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{r.template}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {chainConfig(r.chainId).name}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {r.deployedAt > 0
                              ? formatDistanceToNow(r.deployedAt, { addSuffix: true })
                              : "-"}
                          </td>
                          <td className="px-3 py-2">
                            <SourceTag source={r.source} />
                          </td>
                          <td className="px-3 py-2 text-right">
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
                    <div className="border-t border-border px-3 py-2 text-right">
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

            <Panel title="Recent inspections">
              {inspections === null ? (
                <SkeletonRows count={2} />
              ) : inspections.length === 0 ? (
                <Empty>No inspections yet. Decode a transaction in Routebook.</Empty>
              ) : (
                <ul className="divide-y divide-border">
                  {inspections.map((hash) => (
                    <li key={hash} className="flex items-center justify-between px-3 py-2.5">
                      <TxHashChip hash={hash} />
                      <Link
                        to="/routebook/$txHash"
                        params={{ txHash: hash }}
                        className="font-mono text-xs text-primary hover:underline"
                      >
                        Re-open →
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* Right: tools */}
          <div className="space-y-4 lg:col-span-2">
            <Panel title="Quick deploy">
              <div className="space-y-3 p-3">
                <select
                  value={quickTemplate}
                  onChange={(e) => setQuickTemplate(e.target.value)}
                  className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                >
                  {TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · {t.category}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {TEMPLATES.find((t) => t.id === quickTemplate)?.description}
                </p>
                <Link
                  to="/launchkit/deploy"
                  search={{ template: quickTemplate }}
                  className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  <Rocket className="h-3.5 w-3.5" />
                  Open deploy wizard
                </Link>
              </div>
            </Panel>

            <Panel title="Inspect a transaction">
              <div className="space-y-3 p-3">
                <input
                  value={quickHash}
                  onChange={(e) => setQuickHash(e.target.value)}
                  placeholder="Paste transaction hash..."
                  className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
                {/^0x[0-9a-fA-F]{64}$/.test(quickHash.trim()) ? (
                  <Link
                    to="/routebook/$txHash"
                    params={{ txHash: quickHash.trim() }}
                    className="flex w-full items-center justify-center gap-2 rounded border border-primary bg-transparent px-3 py-2 font-mono text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Decode transaction
                  </Link>
                ) : (
                  <button
                    disabled
                    className="flex w-full items-center justify-center gap-2 rounded border border-border bg-transparent px-3 py-2 font-mono text-xs font-medium text-meta opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Decode transaction
                  </button>
                )}
                <p className="text-[10px] text-meta">
                  {quickHash.trim() && !/^0x[0-9a-fA-F]{64}$/.test(quickHash.trim())
                    ? "A transaction hash is 0x followed by 64 hex characters."
                    : "Works with any supported transaction."}
                </p>
              </div>
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
                        "flex items-center justify-between gap-3 px-3 py-2.5 font-mono text-xs",
                        c.id === chainId && "bg-primary/5",
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn(
                            "h-1.5 w-1.5 shrink-0 rounded-full",
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
                          #{net!.blockNumber.toLocaleString()} · {gas.text}
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
        </div>

        {stats.updatedAt > 0 && (
          <p className="flex items-center gap-1.5 font-mono text-[10px] text-meta">
            <ShieldCheck className="h-3 w-3" />
            Read from each network&apos;s ProjectRegistry and explorer ·{" "}
            {formatDistanceToNow(stats.updatedAt, { addSuffix: true })}
          </p>
        )}
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  sub,
  loading,
}: {
  value: string;
  label: string;
  sub: string;
  loading?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      {loading ? (
        <>
          <div className="h-7 w-20 animate-pulse rounded bg-surface-2" />
          <div className="mt-2 font-mono text-[10px] uppercase tracking-wider text-meta">
            {label}
          </div>
          <div className="mt-1.5 h-3 w-28 animate-pulse rounded bg-surface-2" />
        </>
      ) : (
        <>
          <div className="truncate font-mono text-2xl font-bold text-foreground">{value}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-meta">
            {label}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground" title={sub}>
            {sub}
          </div>
        </>
      )}
    </div>
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
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {action}
      </div>
      <div>{children}</div>
    </div>
  );
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-6 animate-pulse rounded bg-surface-2" />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center font-mono text-xs text-meta">{children}</div>;
}
