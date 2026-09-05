import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { WalletProfile } from "@/components/web3/WalletProfile";
import { useBurner } from "@/lib/burner/store";
import {
  DEFAULT_UNLOCK_MS,
  UNLOCK_OPTIONS,
  getUnlockMs,
  setUnlockMs,
  touchBurnerSession,
} from "@/lib/burner/session";

import { NetworkSelector } from "@/components/web3/NetworkSelector";

import { useActiveChain } from "@/hooks/useActiveChain";
import { getNetworkStatus } from "@/lib/api/chain.functions";
import { useTheme, type Theme } from "@/lib/theme";
import { storage } from "@/lib/storage";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings: DevStation" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { chainId, config } = useActiveChain();
  const [autoLabel, setAutoLabel] = useState(true);
  const [addressFormat, setAddressFormat] = useState<"truncated" | "full">("truncated");
  const [testing, setTesting] = useState(false);

  const testConnection = async () => {
    setTesting(true);
    try {
      const res = await getNetworkStatus({ data: { chainId } });
      if (res.status === "online") {
        toast.success(`RPC online · block ${res.blockNumber.toLocaleString()}`);
      } else {
        toast.error("RPC offline or unreachable");
      }
    } catch {
      toast.error("RPC test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Settings"]}
        title="Settings"
        subtitle="Configure network, display, and registry preferences."
      />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Section title="Wallet & Profile">
            <FamilyWalletProfile />
            <UnlockWindow />
          </Section>
        </div>

        <Section title="Network Configuration">
          <Row label="Active Network">
            <NetworkSelector className="max-w-xs" />
          </Row>
          <Row label="RPC Endpoint">
            <span className="break-all text-muted-foreground">{config.rpcUrl}</span>
          </Row>
          <Row label="Explorer">
            <span className="break-all text-muted-foreground">{config.explorerUrl}</span>
          </Row>
          <div>
            <button
              onClick={testConnection}
              disabled={testing}
              className="rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
          </div>
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
            <ThemeToggle />
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

// Shows the wallet profile for the active chain family so the connected
/** How long the in-app wallet stays unlocked without activity.
 *
 *  This is the window in which an unattended tab can still spend, so the
 *  trade-off is stated rather than buried: longer is more convenient and
 *  strictly less safe. Injected wallets (QIE Wallet, MetaMask) keep their own
 *  lock and are unaffected. */
function UnlockWindow() {
  const [ms, setMs] = useState<number>(DEFAULT_UNLOCK_MS);
  const exists = useBurner((s) => s.exists);
  useEffect(() => setMs(getUnlockMs()), []);
  if (!exists) return null;
  return (
    <div className="mt-4 border-t border-border pt-4">
      <Row label="Keep wallet unlocked for">
        <select
          value={ms}
          onChange={(e) => {
            const next = Number(e.target.value);
            setUnlockMs(next);
            setMs(next);
            // Move the live session onto the new window straight away, so the
            // choice applies without locking and unlocking again.
            touchBurnerSession();
            toast.success("Unlock window updated");
          }}
          className="max-w-xs rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
        >
          {UNLOCK_OPTIONS.map((o) => (
            <option key={o.ms} value={o.ms}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <p className="mt-1 font-mono text-[10px] text-meta">
        The DevStation wallet stays unlocked for this long after your last action, surviving
        refreshes and browser restarts. The seed phrase is encrypted with a key the browser will not
        hand back to any script, but a longer window is still longer for an unattended tab to be
        used. Only applies to the in-app wallet.
      </p>
    </div>
  );
}

function FamilyWalletProfile() {
  return <WalletProfile />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
      </div>
      <div className="space-y-3 py-4 px-5 sm:px-8 lg:px-12">{children}</div>
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

// Dark / Light theme selector (Appearance).
function ThemeToggle() {
  const theme = useTheme((s) => s.theme);
  const setTheme = useTheme((s) => s.setTheme);
  const opts: { id: Theme; label: string }[] = [
    { id: "dark", label: "Dark" },
    { id: "light", label: "Light" },
  ];
  return (
    <div className="inline-flex rounded border border-border bg-surface p-0.5">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => setTheme(o.id)}
          className={`rounded px-3 py-1 font-mono text-xs transition ${
            theme === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
