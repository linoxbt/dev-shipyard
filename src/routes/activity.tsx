import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Activity as ActivityIcon, Rocket, Users, Boxes } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useCombinedDeployStats } from "@/hooks/useProjectRegistry";
import { getAllDeploymentsCombined, type EcosystemDeployment } from "@/lib/api/chain.functions";
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
  // Combined across both networks: every chain with a configured registry.
  const chains = [qieTestnet.id, qieMainnet.id]
    .map((chainId) => ({ chainId, registry: projectRegistryAddress(chainId) }))
    .filter((c) => isContractConfigured(c.registry));
  const onChain = chains.length > 0;
  const stats = useCombinedDeployStats();

  const { data, isLoading } = useQuery({
    queryKey: [
      "all-deployments-combined",
      chains.map((c) => `${c.chainId}:${c.registry}`).join(","),
    ],
    queryFn: () => getAllDeploymentsCombined({ data: { chains } }),
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
        subtitle="Every contract deployed through DevStation across Testnet and Mainnet, recorded onchain in the ProjectRegistry."
      />

      <div className="space-y-5 p-6">
        {/* Ecosystem stats (combined across both networks) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            icon={Rocket}
            label="Total Deployments"
            value={stats.totalDeployments != null ? stats.totalDeployments.toLocaleString() : "—"}
            sub="Testnet + Mainnet"
          />
          <Stat
            icon={Users}
            label="Total Users"
            value={onChain ? stats.uniqueDeployers.toLocaleString() : "—"}
            sub="unique wallets, all networks"
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
            <Empty>The ProjectRegistry is not configured on any network.</Empty>
          ) : isLoading ? (
            <Empty>Loading deployments…</Empty>
          ) : deployments.length === 0 ? (
            <Empty>No contracts have been deployed through DevStation yet.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="bg-surface-2 text-meta">
                  <tr>
                    <Th>Project</Th>
                    <Th>Template</Th>
                    <Th>Network</Th>
                    <Th>Contract</Th>
                    <Th>Deployer</Th>
                    <Th>Age</Th>
                  </tr>
                </thead>
                <tbody>
                  {deployments.map((d) => (
                    <DeploymentRow key={`${d.chainId}:${d.txHash}`} d={d} />
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

function DeploymentRow({ d }: { d: EcosystemDeployment }) {
  const tmpl = getTemplate(d.templateId);
  const slug = slugForChainId(d.chainId ?? qieTestnet.id);
  const isTestnet = slug === "testnet";
  return (
    <tr className="border-t border-border hover:bg-surface-2/50">
      <td className="px-3 py-2.5 text-foreground">{d.projectName || "—"}</td>
      <td className="px-3 py-2.5 text-muted-foreground">{tmpl?.name ?? d.templateId}</td>
      <td className="px-3 py-2.5">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px]",
            isTestnet
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-info/40 bg-info/10 text-info",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", isTestnet ? "bg-warning" : "bg-info")} />
          {isTestnet ? "Testnet" : "Mainnet"}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network: slug, hash: d.contractAddress }}
          className="text-info hover:underline"
        >
          {shortHash(d.contractAddress)}
        </Link>
      </td>
      <td className="px-3 py-2.5">
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network: slug, hash: d.deployer }}
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
