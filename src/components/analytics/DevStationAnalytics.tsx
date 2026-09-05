import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Package, Users, Layers, Rocket, ChevronRight, TrendingUp, Info } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { getAllDeployments, getEcosystemStats } from "@/lib/api/chain.functions";
import { projectRegistryAddress, isContractConfigured } from "@/lib/contracts";
import { ChainLogo } from "@/lib/chain-logos";
import { slugForChainId } from "@/lib/explorer/network";
import { truncateAddress } from "@/lib/wallet";

const AMBER = "#f59e0b";
const CATEGORICAL = [
  "#9945FF",
  "#14b8a6",
  "#f59e0b",
  "#3b82f6",
  "#ec4899",
  "#22c55e",
  "#eab308",
  "#64748b",
];

function dayKey(ts: number): string {
  return new Date(ts * 1000).toISOString().slice(0, 10);
}

export function DevStationAnalytics() {
  const { chainId, chain } = useActiveChain();
  const registry = projectRegistryAddress(chainId);
  const onChain = isContractConfigured(registry);
  // Links stay inside DevStation's own explorer rather than bouncing out to
  // Blockscout: the built-in explorer resolves contract labels and project
  // names, which the external one cannot.
  const network = slugForChainId(chainId);

  const deploysQ = useQuery({
    queryKey: ["analytics-deploys", chainId, registry],
    queryFn: () => getAllDeployments({ data: { chainId, registry } }),
    enabled: onChain,
    refetchInterval: 30_000,
  });
  const statsQ = useQuery({
    queryKey: ["analytics-stats", chainId, registry],
    queryFn: () => getEcosystemStats({ data: { chainId, registry } }),
    enabled: onChain,
    refetchInterval: 30_000,
  });

  // `?? []` allocates a NEW array on every render while the query is empty or
  // loading, which changes the identity the analytics useMemo depends on and
  // makes it recompute the whole 30-day series each render. Memoising the
  // fallback keeps that identity stable.
  const deployments = useMemo(() => deploysQ.data?.deployments ?? [], [deploysQ.data]);

  const { series, templates, deployers, kpis } = useMemo(() => {
    // Deployments per day over the last 30 days (gap-filled).
    const counts = new Map<string, number>();
    for (const d of deployments)
      counts.set(dayKey(d.timestamp), (counts.get(dayKey(d.timestamp)) ?? 0) + 1);
    const days: Array<{ day: string; count: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setUTCDate(dt.getUTCDate() - i);
      const k = dt.toISOString().slice(0, 10);
      days.push({ day: k.slice(5), count: counts.get(k) ?? 0 });
    }

    // Template popularity.
    const tpl = new Map<string, number>();
    for (const d of deployments) tpl.set(d.templateId, (tpl.get(d.templateId) ?? 0) + 1);
    const templates = [...tpl.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Top deployers.
    const dep = new Map<string, number>();
    for (const d of deployments)
      dep.set(d.deployer.toLowerCase(), (dep.get(d.deployer.toLowerCase()) ?? 0) + 1);
    const deployers = [...dep.entries()]
      .map(([addr, count]) => ({ addr, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const kpis = {
      total: statsQ.data?.totalContracts ?? deployments.length,
      users: statsQ.data?.totalUsers ?? dep.size,
      templates: tpl.size,
      latest: deployments[0]?.timestamp ?? null,
    };
    return { series: days, templates, deployers, kpis };
  }, [deployments, statsQ.data]);

  if (!onChain) {
    return (
      <div className="py-4 lg:py-6 px-5 sm:px-8 lg:px-12">
        <div className="mx-auto max-w-lg rounded border border-border bg-surface p-6 text-center">
          <ChainLogo family={chain.name} size={40} className="mx-auto" />
          <h2 className="mt-3 font-mono text-sm font-bold text-foreground">{chain.name}</h2>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            DevStation&apos;s on-chain <span className="text-foreground">ProjectRegistry</span>{" "}
            isn&apos;t deployed on this network yet, so per-chain deploy analytics aren&apos;t
            available here. Analytics are live on chains with the registry (QIE, BOT Chain). Switch
            networks, or deploy a contract to start recording activity.
          </p>
          <Link
            to="/launchkit/templates"
            className="mt-4 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs text-primary-foreground hover:bg-primary-hover"
          >
            <Rocket className="h-3.5 w-3.5" /> Deploy a contract
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 lg:p-6">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Package} label="Total Deployments" value={kpis.total.toLocaleString()} />
        <Kpi icon={Users} label="Unique Deployers" value={kpis.users.toLocaleString()} />
        <Kpi icon={Layers} label="Templates Used" value={kpis.templates.toLocaleString()} />
        <Kpi
          icon={TrendingUp}
          label="Last Deploy"
          value={kpis.latest ? new Date(kpis.latest * 1000).toLocaleDateString() : "-"}
        />
      </div>

      {/* Deployments over time */}
      <Card title="Deployments over time" subtitle="last 30 days">
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="depFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={AMBER} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={AMBER} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2933" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                width={28}
                allowDecimals={false}
                tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v: number) => [`${v} deploys`, ""]}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke={AMBER}
                strokeWidth={2}
                fill="url(#depFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Template popularity */}
        <Card title="Template popularity" subtitle="deployments by template">
          <div className="h-64 w-full">
            {templates.length === 0 ? (
              <Empty>No deployments yet</Empty>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={templates}
                  layout="vertical"
                  margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                >
                  <CartesianGrid stroke="#1f2933" horizontal={false} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fill: "#6b7280", fontSize: 10, fontFamily: "monospace" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fill: "#9ca3af", fontSize: 10, fontFamily: "monospace" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#ffffff08" }} />
                  <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                    {templates.map((_, i) => (
                      <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Top deployers */}
        <Card title="Top deployers" subtitle="by deployment count">
          <div className="max-h-64 overflow-y-auto">
            {deployers.length === 0 && <Empty>No deployers yet</Empty>}
            {deployers.map((d, i) => (
              <div
                key={d.addr}
                className="flex items-center gap-3 border-b border-border px-4 py-2 font-mono text-xs last:border-0"
              >
                <span className="w-5 text-meta">#{i + 1}</span>
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
                />
                <Link
                  to="/explorer/$network/address/$hash"
                  params={{ network, hash: d.addr }}
                  className="truncate text-primary hover:underline"
                >
                  {truncateAddress(d.addr, 8, 6)}
                </Link>
                <span className="ml-auto text-foreground">{d.count}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Recent deployments */}
      <Card title="Recent deployments" subtitle={`${deployments.length} total on ${chain.name}`}>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
          <span>Project / Template</span>
          <span className="hidden text-right sm:block">Deployer</span>
          <span className="text-right">When</span>
        </div>
        {deployments.slice(0, 12).map((d) => (
          <Link
            key={d.txHash}
            to="/explorer/$network/tx/$hash"
            params={{ network, hash: d.txHash }}
            className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
          >
            <span className="min-w-0">
              <span className="block truncate text-foreground">{d.projectName || "Untitled"}</span>
              <span className="block truncate text-meta">{d.templateId}</span>
            </span>
            <span className="hidden text-right text-primary sm:block">
              {truncateAddress(d.deployer, 6, 4)}
            </span>
            <span className="inline-flex items-center gap-1 text-right text-meta">
              {d.timestamp ? new Date(d.timestamp * 1000).toLocaleDateString() : "-"}
              <ChevronRight className="h-3 w-3" />
            </span>
          </Link>
        ))}
        {deployments.length === 0 && <Empty>No deployments recorded yet</Empty>}
      </Card>

      <p className="flex items-center gap-1.5 font-mono text-[10px] text-meta">
        <Info className="h-3 w-3" /> Sourced live from DevStation&apos;s on-chain ProjectRegistry on{" "}
        {chain.name}.
      </p>
    </div>
  );
}

const tooltipStyle = {
  background: "#0a0e13",
  border: "1px solid #1f2933",
  borderRadius: 6,
  fontFamily: "monospace",
  fontSize: 11,
} as const;

function Kpi({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="font-mono text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-baseline justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-xs font-bold text-foreground">{title}</span>
        {subtitle && <span className="font-mono text-[10px] text-meta">{subtitle}</span>}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center py-6 font-mono text-xs text-meta">
      {children}
    </div>
  );
}
