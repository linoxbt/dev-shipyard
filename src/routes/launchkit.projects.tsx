import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Rocket, ExternalLink, X, Cpu } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddressChip } from "@/components/shared/AddressChip";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ContractInteractor } from "@/components/editor/ContractInteractor";
import { useProjects, type DeployedProject } from "@/lib/mock/projects";
import { useProjectRegistry } from "@/hooks/useProjectRegistry";
import { useActiveChain } from "@/hooks/useActiveChain";

export const Route = createFileRoute("/launchkit/projects")({
  head: () => ({ meta: [{ title: "My Projects — DevStation" }] }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const storeProjects = useProjects((s) => s.projects);
  const remove = useProjects((s) => s.remove);
  const { deployments: registryProjects, onChain } = useProjectRegistry();
  const { config, chainId } = useActiveChain();
  const [selected, setSelected] = useState<DeployedProject | null>(null);
  const [interact, setInteract] = useState<DeployedProject | null>(null);

  // Merge on-chain registry deployments with the local store, deduped by txHash.
  const seen = new Set(storeProjects.map((p) => p.txHash));
  const extra = registryProjects
    .filter((p) => !seen.has(p.txHash))
    .map(
      (p): DeployedProject => ({
        id: p.id,
        name: p.name,
        templateId: p.templateId,
        templateName: p.templateName,
        address: p.address,
        txHash: p.txHash,
        blockNumber: p.blockNumber,
        deployedAt: p.deployedAt,
        status: p.status,
        constructorArgs: p.constructorArgs,
        abi: p.abi,
        chainId: p.chainId,
      }),
    );
  const projects = [...extra, ...storeProjects];

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Projects"]}
        title="My Projects"
        subtitle="Every contract you've deployed through DevStation."
        action={
          <Link
            to="/launchkit/deploy"
            className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Rocket className="h-3.5 w-3.5" /> New Deployment
          </Link>
        }
      />

      <div className="p-6">
        {onChain && (
          <div className="mb-3 flex items-center gap-1.5 font-mono text-[10px] text-success">
            <span className="h-1.5 w-1.5 rounded-full bg-success" /> Reading from on-chain
            ProjectRegistry
          </div>
        )}
        {projects.length === 0 ? (
          <div className="rounded border border-border bg-surface p-10 text-center">
            <p className="font-mono text-xs text-meta">No deployments yet.</p>
            <Link
              to="/launchkit/templates"
              className="mt-3 inline-block font-mono text-xs text-primary hover:underline"
            >
              Deploy your first contract →
            </Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded border border-border bg-surface">
            <table className="w-full font-mono text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2 text-meta">
                  <th className="px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px]">
                    Name
                  </th>
                  <th className="px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px]">
                    Template
                  </th>
                  <th className="px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px]">
                    Address
                  </th>
                  <th className="px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px]">
                    Deployed
                  </th>
                  <th className="px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px]">
                    Status
                  </th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => setSelected(p)}
                    className="cursor-pointer border-b border-border transition last:border-0 hover:bg-surface-2"
                  >
                    <td className="px-3 py-2.5 text-foreground">{p.name}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">{p.templateName}</td>
                    <td className="px-3 py-2.5">
                      <AddressChip address={p.address} showLabel={false} />
                    </td>
                    <td
                      className="px-3 py-2.5 text-muted-foreground"
                      title={new Date(p.deployedAt).toUTCString()}
                    >
                      {formatDistanceToNow(p.deployedAt, { addSuffix: true })}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusBadge kind={p.status} />
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        {p.abi && p.abi.length > 0 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setInteract(p);
                            }}
                            className="flex items-center gap-1 font-mono text-info hover:underline"
                          >
                            <Cpu className="h-3 w-3" /> Interact
                          </button>
                        )}
                        <Link
                          to="/routebook/$txHash"
                          params={{ txHash: p.txHash }}
                          onClick={(e) => e.stopPropagation()}
                          className="font-mono text-primary hover:underline"
                        >
                          Inspect →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-background/60 backdrop-blur-sm"
            onClick={() => setSelected(null)}
          />
          <aside className="w-full max-w-md overflow-y-auto border-l border-border bg-surface p-6">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
                  Project
                </div>
                <h2 className="font-mono text-lg font-bold text-foreground">{selected.name}</h2>
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded p-1 text-meta hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <dl className="space-y-3 font-mono text-xs">
              <Field label="Template">{selected.templateName}</Field>
              <Field label="Status">
                <StatusBadge kind={selected.status} />
              </Field>
              <Field label="Contract Address">
                <AddressChip address={selected.address} showLabel={false} full />
              </Field>
              <Field label="Tx Hash">
                <TxHashChip hash={selected.txHash} />
              </Field>
              <Field label="Block">#{selected.blockNumber.toLocaleString()}</Field>
              <Field label="Deployed">{new Date(selected.deployedAt).toUTCString()}</Field>
            </dl>

            <div className="mt-6">
              <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">
                Constructor Arguments
              </h3>
              <div className="rounded border border-border bg-background p-3 font-mono text-xs">
                {Object.entries(selected.constructorArgs).map(([k, v]) => (
                  <div key={k} className="flex gap-3 py-0.5">
                    <span className="text-meta">{k}:</span>
                    <span className="break-all text-code">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-col gap-2">
              <Link
                to="/routebook/$txHash"
                params={{ txHash: selected.txHash }}
                className="flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
              >
                Inspect in Routebook
              </Link>
              <a
                href={`${config.explorerUrl}/address/${selected.address}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center justify-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                Open on Explorer <ExternalLink className="h-3 w-3" />
              </a>
              <button
                onClick={() => {
                  remove(selected.id);
                  setSelected(null);
                }}
                className="rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-danger hover:text-danger"
              >
                Remove from History
              </button>
            </div>
          </aside>
        </div>
      )}
      {/* Interact panel */}
      {interact && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="flex-1 bg-background/60 backdrop-blur-sm"
            onClick={() => setInteract(null)}
          />
          <aside className="w-full max-w-md overflow-y-auto border-l border-border bg-surface p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
                  Interact
                </div>
                <h2 className="font-mono text-lg font-bold text-foreground">{interact.name}</h2>
                <AddressChip address={interact.address} showLabel={false} full />
              </div>
              <button
                onClick={() => setInteract(null)}
                className="rounded p-1 text-meta hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {interact.abi && interact.abi.length > 0 ? (
              <ContractInteractor
                contractAddress={interact.address as `0x${string}`}
                abi={interact.abi}
                chainId={interact.chainId ?? chainId}
              />
            ) : (
              <p className="font-mono text-xs text-meta">
                No ABI stored for this contract — interaction is only available for contracts
                deployed locally through DevStation.
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-meta">{label}</dt>
      <dd className="mt-0.5 text-foreground">{children}</dd>
    </div>
  );
}
