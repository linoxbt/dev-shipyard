// Stacks variant of the Deploy page — rendered by /launchkit/deploy when the
// active chain family is Stacks. Deploys a Clarity contract via the connected
// Stacks wallet, and surfaces the Post-Condition Coverage audit inline.

import { useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import Editor from "@monaco-editor/react";
import { Rocket, Loader2, ExternalLink, CheckCircle2, ShieldCheck, ShieldAlert, Shield } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { StacksWalletPanel } from "@/components/stacks/StacksWalletPanel";
import { StacksNetworkSelector } from "@/components/stacks/StacksNetworkSelector";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { stacksExplorerLink } from "@/lib/stacks/chains";
import { STACKS_TEMPLATES, stacksTemplate } from "@/lib/stacks/templates";
import { auditSource, coverageLabel } from "@/lib/stacks/audit";
import { recordStacksDeploy } from "@/lib/stacks/deploy-history";

export function StacksDeployView() {
  const search = useSearch({ strict: false }) as { template?: string };
  const template = useMemo(
    () => stacksTemplate(search.template ?? "") ?? STACKS_TEMPLATES[0],
    [search.template],
  );

  const wallet = useStacksWallet();
  const [name, setName] = useState(template.contractName);
  const [code, setCode] = useState(template.clarity);
  const [mode, setMode] = useState<"deny" | "allow">("deny");
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);

  // Live post-condition coverage audit. Templates ship a post-condition, so a
  // template counts as 1 declared; a hand-written contract with none will flag.
  const audit = useMemo(
    () => auditSource(code, { postConditionMode: mode, declaredCount: template.postConditions ? 1 : 0, contractId: name }),
    [code, mode, name, template.postConditions],
  );
  const cov = coverageLabel(audit.coverage);

  const onDeploy = async () => {
    if (!wallet.connected) return toast.error("Connect a Stacks wallet first (Leather / Xverse).");
    if (!name.trim()) return toast.error("Enter a contract name.");
    setBusy(true);
    setTxid(null);
    try {
      const id = await wallet.deployContract({ name: name.trim(), code, postConditionMode: mode });
      setTxid(id);
      recordStacksDeploy({
        kind: template.kind === "payment" ? "payment" : template.kind === "nft" ? "nft" : "token",
        network: wallet.network,
        contractName: `${wallet.address}.${name.trim()}`,
        txid: id,
        deployer: wallet.address ?? undefined,
        templateId: template.id,
        coverage: audit.coverage,
        timestamp: Math.floor(Date.now() / 1000),
      });
      toast.success("Contract deploy submitted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Deploy"]}
        title={`Deploy: ${template.name}`}
        subtitle={template.description}
      />

      <div className="grid gap-6 p-4 lg:grid-cols-3 lg:p-6">
        <div className="space-y-4 lg:col-span-2">
          <label className="block">
            <span className="font-mono text-xs text-meta">Contract name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value.replace(/[^a-z0-9-]/g, ""))}
              className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
            />
          </label>

          <div className="h-72 overflow-hidden rounded border border-border">
            <Editor
              height="100%"
              language="clojure"
              theme="vs-dark"
              value={code}
              onChange={(v) => setCode(v ?? "")}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                automaticLayout: true,
                padding: { top: 12 },
              }}
            />
          </div>

          <button
            onClick={onDeploy}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-sm text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            {busy ? "Submitting…" : `Deploy on ${wallet.networkName}`}
          </button>

          {txid && (
            <div className="space-y-2 rounded border border-success/40 bg-success/10 p-4 font-mono text-xs">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" /> Deploy submitted
              </div>
              <a
                href={stacksExplorerLink(wallet.network, "txid", txid)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 truncate text-primary hover:underline"
              >
                {txid} <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">Network</div>
            <StacksNetworkSelector />
          </div>
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">Wallet</div>
            <StacksWalletPanel />
          </div>

          {/* Post-condition coverage — the differentiator */}
          <div className="rounded border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-xs font-bold text-foreground">
                {cov.tone === "good" ? (
                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                ) : cov.tone === "warn" ? (
                  <Shield className="h-3.5 w-3.5 text-warning" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 text-danger" />
                )}
                Post-Condition Coverage
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  cov.tone === "good"
                    ? "border-success/40 bg-success/10 text-success"
                    : cov.tone === "warn"
                      ? "border-warning/40 bg-warning/10 text-warning"
                      : "border-danger/40 bg-danger/10 text-danger"
                }`}
              >
                {cov.text}
              </span>
            </div>
            <div className="space-y-2 p-3">
              <label className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                Post-condition mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as "deny" | "allow")}
                  className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                >
                  <option value="deny">deny</option>
                  <option value="allow">allow</option>
                </select>
              </label>
              {audit.transferPaths.length === 0 && (
                <div className="font-mono text-[11px] text-meta">No asset-transfer paths found.</div>
              )}
              {audit.details.map((d, i) => (
                <div key={i} className="rounded border border-border bg-background p-2 font-mono text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={
                        d.status === "covered" ? "text-success" : d.status === "unknown-risk" ? "text-warning" : "text-danger"
                      }
                    >
                      ●
                    </span>
                    <span className="text-foreground">{d.functionName}</span>
                    <span className="text-meta">· {d.assetType}</span>
                    <span className="ml-auto text-meta">{d.status}</span>
                  </div>
                  <div className="mt-1 text-muted-foreground">{d.note}</div>
                </div>
              ))}
              <div className="rounded border border-border bg-background p-2 font-mono text-[10px] text-meta">
                <div className="mb-1 text-foreground">Post-condition for callers:</div>
                <code className="break-all">{template.postConditions}</code>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
