import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { PageHeader } from "@/components/shared/PageHeader";
import { AddressChip } from "@/components/shared/AddressChip";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { LABELS, type ContractLabel } from "@/lib/mock/labels";
import { useContractLabels } from "@/hooks/useContractLabels";
import { toast } from "sonner";

export const Route = createFileRoute("/routebook/labels")({
  head: () => ({ meta: [{ title: "Label Registry — DevStation Routebook" }] }),
  component: LabelRegistry,
});

const FILTERS = [
  "All",
  "Verified",
  "Community",
  "Auto-labeled",
  "DeFi",
  "Token",
  "NFT",
  "Infrastructure",
  "Gaming",
  "Identity",
  "Governance",
];

function LabelRegistry() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const [modal, setModal] = useState(false);

  const filtered = useMemo(() => {
    return LABELS.filter((l) => {
      if (
        q &&
        !l.name.toLowerCase().includes(q.toLowerCase()) &&
        !l.address.toLowerCase().includes(q.toLowerCase())
      )
        return false;
      if (filter === "All") return true;
      if (filter === "Verified") return l.source === "VERIFIED";
      if (filter === "Community") return l.source === "COMMUNITY";
      if (filter === "Auto-labeled") return l.source === "AUTO";
      return l.category === filter;
    });
  }, [q, filter]);

  const stats = {
    total: LABELS.length,
    community: LABELS.filter((l) => l.source === "COMMUNITY").length,
    auto: LABELS.filter((l) => l.source === "AUTO").length,
    verified: LABELS.filter((l) => l.source === "VERIFIED").length,
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Routebook", "Labels"]}
        title="Contract Label Registry"
        subtitle="Human-readable names for every contract on QIE Testnet."
        action={
          <button
            onClick={() => setModal(true)}
            className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            + Submit a Label
          </button>
        }
      />

      <div className="space-y-4 p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat value={stats.total} label="Total Labels" />
          <Stat value={stats.verified} label="Verified" />
          <Stat value={stats.community} label="Community" />
          <Stat value={stats.auto} label="Auto-labeled (DevStation)" />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
                filter === f
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by address or name..."
            className="ml-auto w-72 rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
          />
        </div>

        {/* Table */}
        <div className="overflow-hidden rounded border border-border bg-surface">
          <table className="w-full font-mono text-xs">
            <thead className="bg-surface-2 text-meta">
              <tr>
                <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">
                  Contract
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">
                  Label
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">
                  Category
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">
                  Source
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">
                  Submitter
                </th>
                <th className="px-3 py-2 text-left text-[10px] font-normal uppercase tracking-wider">
                  Date
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <Row key={l.address} label={l} />
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-meta">
                    No labels match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modal && <SubmitLabelModal onClose={() => setModal(false)} />}
    </div>
  );
}

function Row({ label }: { label: ContractLabel }) {
  return (
    <tr className="border-t border-border">
      <td className="px-3 py-2">
        <AddressChip address={label.address} showLabel={false} />
      </td>
      <td className="px-3 py-2 text-info">{label.name}</td>
      <td className="px-3 py-2 text-muted-foreground">{label.category}</td>
      <td className="px-3 py-2">
        <StatusBadge kind={label.source} />
      </td>
      <td className="px-3 py-2 text-muted-foreground">{label.submitter}</td>
      <td className="px-3 py-2 text-meta">
        {formatDistanceToNow(label.submittedAt, { addSuffix: true })}
      </td>
    </tr>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="font-mono text-2xl font-bold text-foreground">{value}</div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
    </div>
  );
}

function SubmitLabelModal({ onClose }: { onClose: () => void }) {
  const { submitLabel, onChain } = useContractLabels();
  const [addr, setAddr] = useState("");
  const [name, setName] = useState("");
  const [cat, setCat] = useState("DeFi");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!addr || !name) {
      toast.error("Address and label name are required");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
      toast.error("Enter a valid contract address");
      return;
    }
    if (!onChain) {
      toast.success("Label submitted · awaiting review");
      onClose();
      return;
    }
    setBusy(true);
    try {
      await submitLabel({
        contractAddress: addr as `0x${string}`,
        name,
        category: cat,
        description: desc,
      });
      toast.success("Label submitted on-chain · awaiting approval");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded border border-border bg-surface p-6">
        <div className="mb-4 flex items-start justify-between">
          <h2 className="font-mono text-base font-bold text-foreground">Submit a Contract Label</h2>
          <button onClick={onClose} className="text-meta hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 font-mono text-xs">
          <Field label="Contract Address">
            <input
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="0x..."
              className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Label Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. QIE DEX Router"
              className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
          </Field>
          <Field label="Category">
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-2 text-foreground focus:border-primary focus:outline-none"
            >
              {["DeFi", "Token", "Gaming", "Identity", "Infrastructure", "DAO", "Other"].map(
                (c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ),
              )}
            </select>
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={desc}
              maxLength={200}
              onChange={(e) => setDesc(e.target.value)}
              rows={2}
              className="w-full rounded border border-border bg-background px-3 py-2 text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
            <div className="text-right text-[10px] text-meta">{desc.length}/200</div>
          </Field>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          >
            {busy ? "Submitting…" : onChain ? "Submit On-Chain" : "Submit Label"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-meta">{label}</span>
      {children}
    </label>
  );
}
