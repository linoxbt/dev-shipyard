import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Rocket, Search, ArrowRight, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { useProjects } from "@/lib/mock/projects";
import { TEMPLATES } from "@/lib/mock/templates";
import { DEFAULT_GAS_GWEI } from "@/lib/chains";
import { useActiveChain } from "@/hooks/useActiveChain";
import { storage } from "@/lib/storage";
import { useNetworkStatus } from "@/hooks/useChainData";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "DevStation — Overview" },
      {
        name: "description",
        content: "Your QIE builder console: deployments, network status, and quick tools.",
      },
    ],
  }),
  component: Overview,
});

function Overview() {
  const projects = useProjects((s) => s.projects);
  const [quickTemplate, setQuickTemplate] = useState(TEMPLATES[0].id);
  const [quickHash, setQuickHash] = useState("");

  const { chainId, chain, config } = useActiveChain();
  const { data: net } = useNetworkStatus(chainId);
  const [inspections, setInspections] = useState<string[]>([]);
  useEffect(() => setInspections(storage.loadInspections()), []);

  const block = net?.blockNumber ?? 0;
  const gasGwei = net?.gasPriceGwei ?? DEFAULT_GAS_GWEI;
  const online = net?.status === "online";

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation"]}
        title="Overview"
        subtitle="Deploy contracts. Decode transactions. Ship faster on QIE."
      />

      <div className="space-y-6 p-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            value={projects.length.toString()}
            label="Your Deployments"
            sub={`across ${new Set(projects.map((p) => p.templateId)).size} templates`}
          />
          <Stat
            value={online ? block.toLocaleString() : "—"}
            label="Current Block"
            sub={online ? `${chain.name} · Chain ${chain.id}` : "RPC offline"}
            pulse={online}
          />
          <Stat
            value={`${gasGwei.toFixed(2)} Gwei`}
            label="Gas Price"
            sub={`≈ ${(gasGwei * 21000 * 1e-9).toFixed(6)} QIE per tx`}
          />
          <Stat
            value={TEMPLATES.length.toString()}
            label="Templates"
            sub={`${TEMPLATES.filter((t) => t.verified).length} verified`}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Left: activity */}
          <div className="space-y-6 lg:col-span-3">
            <Panel
              title="Your Deployments"
              action={
                <Link
                  to="/launchkit/projects"
                  className="font-mono text-xs text-primary hover:underline"
                >
                  View all →
                </Link>
              }
            >
              {projects.length === 0 ? (
                <Empty>No deployments yet. Start with a template.</Empty>
              ) : (
                <table className="w-full font-mono text-xs">
                  <thead className="text-meta">
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left font-normal">Name</th>
                      <th className="px-3 py-2 text-left font-normal">Template</th>
                      <th className="px-3 py-2 text-left font-normal">Deployed</th>
                      <th className="px-3 py-2 text-left font-normal">Status</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.slice(0, 5).map((p) => (
                      <tr key={p.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-foreground">{p.name}</td>
                        <td className="px-3 py-2 text-muted-foreground">{p.templateName}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {formatDistanceToNow(p.deployedAt, { addSuffix: true })}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge
                            kind={
                              p.status === "VERIFIED"
                                ? "VERIFIED"
                                : p.status === "PENDING"
                                  ? "PENDING"
                                  : "FAILED"
                            }
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Link
                            to="/routebook/$txHash"
                            params={{ txHash: p.txHash }}
                            className="text-meta hover:text-primary"
                          >
                            <ArrowRight className="inline h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title="Recent Inspections">
              {inspections.length === 0 ? (
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
            <Panel title="Quick Deploy">
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
                  Open Deploy Wizard
                </Link>
              </div>
            </Panel>

            <Panel title="Inspect a Transaction">
              <div className="space-y-3 p-3">
                <input
                  value={quickHash}
                  onChange={(e) => setQuickHash(e.target.value)}
                  placeholder="Paste transaction hash..."
                  className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
                {quickHash.trim() ? (
                  <Link
                    to="/routebook/$txHash"
                    params={{ txHash: quickHash.trim() }}
                    className="flex w-full items-center justify-center gap-2 rounded border border-primary bg-transparent px-3 py-2 font-mono text-xs font-medium text-primary hover:bg-primary/10"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Decode Transaction
                  </Link>
                ) : (
                  <button
                    disabled
                    className="flex w-full items-center justify-center gap-2 rounded border border-border bg-transparent px-3 py-2 font-mono text-xs font-medium text-meta opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Decode Transaction
                  </button>
                )}
                <p className="text-[10px] text-meta">Works with any QIE transaction.</p>
              </div>
            </Panel>

            <Panel title="Network Status">
              <div className="space-y-2 p-3 font-mono text-xs">
                <Row label="Block height" value={online ? block.toLocaleString() : "—"} />
                <Row label="Gas price" value={`${gasGwei.toFixed(2)} Gwei`} />
                <Row
                  label="RPC"
                  value={
                    <span className="flex items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${online ? "bg-success" : "bg-danger"}`}
                      />
                      <span className="text-muted-foreground">{new URL(config.rpcUrl).host}</span>
                    </span>
                  }
                />
                <Row
                  label="Explorer"
                  value={
                    <a
                      href={config.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary"
                    >
                      {new URL(config.explorerUrl).host} <ExternalLink className="h-3 w-3" />
                    </a>
                  }
                />
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  sub,
  pulse,
}: {
  value: string;
  label: string;
  sub: string;
  pulse?: boolean;
}) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div
        className={`font-mono text-2xl font-bold text-foreground ${pulse ? "animate-pulse-soft" : ""}`}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-meta">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center font-mono text-xs text-meta">{children}</div>;
}
