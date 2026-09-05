import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, Rocket, BadgeCheck, Layers, CalendarClock, Store } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { getDeployerProfile } from "@/lib/api/profile.functions";
import { useNetworkPref } from "@/lib/active-chain";
import { chainConfig } from "@/lib/chains";
import { slugForChainId } from "@/lib/explorer/network";
import { shortAddr, timeAgo } from "@/lib/explorer/format";
import { reputationSummary, TIER_LABEL } from "@/lib/reputation";

// A developer's public profile, keyed to their wallet.
//
// Everything here is derived from chain: what ProjectRegistry says they
// deployed, and what the explorer says about those contracts' source
// verification. There is no editable field anywhere, by design: a reputation
// someone can type in tells you nothing about them.

export const Route = createFileRoute("/dev/$address")({
  component: DeveloperProfile,
});

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Rocket;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="rounded border border-border bg-surface-2 p-3">
      <div className="flex items-center gap-1.5 text-meta">
        <Icon className="h-3 w-3" />
        <span className="font-mono text-[10px] uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 font-mono text-lg font-bold text-foreground">{value}</p>
      {sub && <p className="font-mono text-[10px] text-meta">{sub}</p>}
    </div>
  );
}

function DeveloperProfile() {
  const { address } = Route.useParams();
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const chain = chainConfig(chainId);

  const valid = /^0x[a-fA-F0-9]{40}$/.test(address);

  const { data, isLoading } = useQuery({
    queryKey: ["deployer-profile", chainId, address.toLowerCase()],
    queryFn: () => getDeployerProfile({ data: { chainId, address } }),
    enabled: valid,
    staleTime: 60_000,
  });

  if (!valid) {
    return (
      <div>
        <PageHeader breadcrumb={["DevStation", "Developer"]} title="Developer" />
        <div className="py-6 px-5 sm:px-8 lg:px-12">
          <p className="font-mono text-xs text-muted-foreground">That is not a wallet address.</p>
        </div>
      </div>
    );
  }

  const rep = data?.available ? data.reputation : null;
  // Distinguishing "not checked" from "none verified" matters: reporting 0%
  // for an unreachable explorer would defame a developer whose contracts are
  // all verified.
  const rate =
    rep && rep.verificationRate !== null ? `${Math.round(rep.verificationRate * 100)}%` : "-";

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Developer"]}
        title={shortAddr(address)}
        subtitle={`Deployments recorded on ${chain.name}. Everything here is read from chain.`}
      />
      <div className="space-y-4 py-4 sm:py-6 px-5 sm:px-8 lg:px-12">
        {isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Reading the registry…</p>
        ) : !data?.available ? (
          <div className="rounded border border-dashed border-border p-12 text-center">
            <ShieldCheck className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              {data?.reason === "no_registry"
                ? `No project registry is deployed on ${chain.name}.`
                : "The registry is unreachable, so this profile cannot be read right now."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
              <Stat
                icon={Rocket}
                label="Contracts"
                value={data.totalDeployments}
                sub={TIER_LABEL[rep!.tier]}
              />
              <Stat
                icon={BadgeCheck}
                label="Verified"
                value={rate}
                sub={
                  rep!.verificationRate === null
                    ? "explorer unavailable"
                    : data.sampled
                      ? `of the latest ${rep!.deployments}`
                      : `${rep!.verified} of ${rep!.deployments}`
                }
              />
              <Stat
                icon={Layers}
                label="Networks"
                value={rep!.networks.length}
                sub={rep!.templates.length ? `${rep!.templates.length} templates` : undefined}
              />
              {data.templatesAvailable && (
                <Stat
                  icon={Store}
                  label="Templates"
                  value={rep!.templatesPublished}
                  sub={
                    rep!.templatesPublished === 0
                      ? "none published"
                      : `used ${rep!.templateDeploys} time${rep!.templateDeploys === 1 ? "" : "s"}`
                  }
                />
              )}
              <Stat
                icon={CalendarClock}
                label="Active"
                value={rep!.activeDays ? `${rep!.activeDays}d` : "-"}
                sub={
                  rep!.firstAt
                    ? `since ${timeAgo(new Date(rep!.firstAt).toISOString())}`
                    : undefined
                }
              />
            </div>

            <p className="font-mono text-[11px] text-muted-foreground">{reputationSummary(rep!)}</p>

            {data.deployments.length > 0 && (
              <div className="overflow-x-auto rounded border border-border">
                <table className="w-full min-w-[560px] text-left font-mono text-xs">
                  <thead className="border-b border-border bg-surface-2 text-meta">
                    <tr>
                      <th className="px-3 py-2 font-normal">Project</th>
                      <th className="px-3 py-2 font-normal">Contract</th>
                      <th className="px-3 py-2 font-normal">Template</th>
                      <th className="px-3 py-2 text-right font-normal">Deployed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.deployments.map((d) => (
                      <tr key={d.txHash} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-foreground">{d.projectName || "-"}</td>
                        <td className="px-3 py-2">
                          <Link
                            to="/explorer/$network/address/$hash"
                            params={{
                              network: slugForChainId(chainId),
                              hash: d.contractAddress,
                            }}
                            className="text-muted-foreground hover:underline"
                          >
                            {shortAddr(d.contractAddress)}
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{d.templateId || "-"}</td>
                        <td className="px-3 py-2 text-right text-meta">
                          {Number(d.deployedAt) > 0
                            ? timeAgo(new Date(Number(d.deployedAt)).toISOString())
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="font-mono text-[10px] text-meta">
              Source: ProjectRegistry on {chain.name} · verification from the block explorer.
              Nothing on this page is self-reported.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
