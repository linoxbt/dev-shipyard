import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, Rocket, Users, Boxes } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useGlobalDeployStats } from "@/hooks/useProjectRegistry";
import { getAllDeployments, type EcosystemDeployment } from "@/lib/api/chain.functions";
import { projectRegistryAddress, isContractConfigured } from "@/lib/contracts";
import { getTemplate } from "@/lib/mock/templates";
import { qieTestnet, qieMainnet } from "@/lib/chains";
import { slugForChainId } from "@/lib/explorer/network";
import { timeAgo, shortHash, shortAddr } from "@/lib/explorer/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/activity")({
  head: () => ({ meta: [{ title: "Activity — DevStation" }] }),
  component: ActivityPage,
});

function ActivityPage() {
  const { chain, chainId, select } = useActiveChain();
  const slug = slugForChainId(chainId);
  const registry = projectRegistryAddress(chainId);
  const onChain = isContractConfigured(registry);
  const stats = useGlobalDeployStats();

  const { data, isLoading } = useQuery({
    queryKey: ["all-deployments", chainId, registry],
    queryFn: () => getAllDeployments({ data: { chainId, registry } }),
    enabled: onChain,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const deployments = data?.deployments ?? [];

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Activity"]}
        title="DevStation Activity"
        subtitle="Every contract deployed through DevStation, recorded onchain in the ProjectRegistry."
      />

      <div className="space-y-5 p-6">
        {/* Network switch */}
        <div className="inline-flex rounded border border-border bg-surface p-0.5">
          {[qieTestnet, qieMainnet].map((c) => {
            const active = chainId === c.id;
            return (
              <button
                key={c.id}
                onClick={() => select(c.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs transition",
                  active
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn("h-1.5 w-1.5 rounded-full", c.testnet ? "bg-warning" : "bg-info")}
                />
                {c.testnet ? "Testnet" : "Mainnet"}
              </button>
            );
          })}
        </div>

        {/* Ecosystem stats (network-scoped) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            icon={Rocket}
            label="Total Deployments"
            value={stats.totalDeployments != null ? stats.totalDeployments.toLocaleString() : "—"}
            sub={`on QIE ${chain.testnet ? "Testnet" : "Mainnet"}`}
          />
          <Stat
            icon={Users}
            label="Total Users"
            value={onChain ? stats.uniqueDeployers.toLocaleString() : "—"}
            sub="wallets that deployed"
          />
          <Stat
            icon={Boxes}
            label="Templates Used"
            value={new Set(deployments.map((d) => d.templateId)).size.toString()}
            sub="distinct templates"
          />
        </div>

        {/* All deployments */}
        <div className="overflow-hidden rounded border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <ActivityIcon className="h-3.5 w-3.5 text-primary" />
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              All Deployments
            </h2>
          </div>
          {!onChain ? (
            <Empty>The ProjectRegistry is not configured for {chain.name}.</Empty>
          ) : isLoading ? (
            <Empty>Loading deployments…</Empty>
          ) : deployments.length === 0 ? (
            <Empty>No contracts have been deployed through DevStation on {chain.name} yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="bg-surface-2 text-meta">
                  <tr>
                    <Th>Project</Th>
                    <Th>Template</Th>
                    <Th>Contract</Th>
                    <Th>Deployer</Th>
                    <Th>Age</Th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => (
                    <DeploymentRow key={d.txHash} d={d} network={slug} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DeploymentRow({ d, network }: { d: EcosystemDeployment; network: "testnet" | "mainnet" }) {
  const tmpl = getTemplate(d.templateId);
  return (
    <tr className="border-t border-border hover:bg-surface-2/50">
      <td className="px-3 py-2.5 text-foreground">{d.projectName || "—"}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{tmpl?.name ?? d.templateId}</td>
      <td className="px-3 py-2.5">
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network, hash: d.contractAddress }}
          className="text-info hover:underline"
        >
          {shortHash(d.contractAddress)}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network, hash: d.deployer }}
          className="text-info hover:underline"
        >
          {shortAddr(d.deployer)}
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
        {d.timestamp ? timeAgo(new Date(d.timestamp * 1000).toISOString()) : "—"}
      </td>
    </tr>
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
    <div className="rounded border border-border bg-surface p-4">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-bold text-foreground">{value}</div>
      {sub && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px]">
      {children}
    </th>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center font-mono text-xs text-meta">{children}</div>;
}
