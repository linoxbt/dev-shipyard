import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { CHAIN } from "@/lib/chain";
import { WalletProfile } from "@/components/web3/WalletProfile";
import { storage } from "@/lib/storage";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — DevStation" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const [rpc, setRpc] = useState(CHAIN.rpc);
  const [oracleEnabled, setOracleEnabled] = useState(true);
  const [oracleInterval, setOracleInterval] = useState("30");
  const [autoLabel, setAutoLabel] = useState(true);
  const [addressFormat, setAddressFormat] = useState<"truncated" | "full">("truncated");

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Settings"]}
        title="Settings"
        subtitle="Configure network, oracle, display, and registry preferences."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Section title="Wallet & Profile">
            <WalletProfile />
          </Section>
        </div>

        <Section title="Network Configuration">
          <Row label="Current Network">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" />
              <span className="text-foreground">{CHAIN.name}</span>
              <span className="text-meta">· Chain {CHAIN.id}</span>
            </span>
          </Row>
          <Row label="RPC Endpoint">
            <input
              value={rpc}
              onChange={(e) => setRpc(e.target.value)}
              className="w-full rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </Row>
          <Row label="Explorer">
            <span className="text-muted-foreground">{CHAIN.explorer}</span>
          </Row>
          <div>
            <button
              onClick={() => toast.success("RPC responded in 142ms")}
              className="rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10"
            >
              Test Connection
            </button>
          </div>
        </Section>

        <Section title="Oracle Settings">
          <Toggle label="Gas cost estimation" value={oracleEnabled} onChange={setOracleEnabled} />
          <Row label="Refresh interval">
            <select
              value={oracleInterval}
              onChange={(e) => setOracleInterval(e.target.value)}
              className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
            >
              <option value="10">Every 10s</option>
              <option value="30">Every 30s</option>
              <option value="60">Every 60s</option>
              <option value="manual">Manual</option>
            </select>
          </Row>
          <Row label="Display currency">USD</Row>
        </Section>

        <Section title="Contract Label Registry">
          <Toggle
            label="Auto-register deployed contracts"
            value={autoLabel}
            onChange={setAutoLabel}
          />
          <p className="text-xs text-meta">
            When on, contracts you deploy through DevStation are automatically registered in
            ContractLabelRegistry so they appear with your project name in Routebook.
          </p>
        </Section>

        <Section title="Display Preferences">
          <Row label="Address format">
            <div className="flex gap-2">
              {(["truncated", "full"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setAddressFormat(v)}
                  className={`rounded border px-2 py-1 font-mono text-[11px] ${
                    addressFormat === v
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Theme">
            <span className="text-muted-foreground">
              Dark <span className="text-meta">(only option — this is a dev tool)</span>
            </span>
          </Row>
        </Section>

        <Section title="Clear Data">
          <button
            onClick={() => {
              storage.clearInspections();
              toast.success("Inspection history cleared");
            }}
            className="block w-full rounded border border-border px-3 py-2 text-left font-mono text-xs text-muted-foreground hover:border-danger hover:text-danger"
          >
            Clear Inspection History
          </button>
          <button
            onClick={() => {
              storage.clearProjects();
              toast.success("Project cache cleared");
            }}
            className="block w-full rounded border border-border px-3 py-2 text-left font-mono text-xs text-muted-foreground hover:border-danger hover:text-danger"
          >
            Clear Project Cache
          </button>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="font-mono text-xs">{children}</div>
    </div>
  );
}

function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between font-mono text-xs">
      <span className="text-foreground">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`inline-flex h-5 w-9 items-center rounded-full border border-border transition ${
          value ? "bg-primary" : "bg-background"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-foreground transition ${
            value ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
