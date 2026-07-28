// Stacks variant of the Contract Editor — rendered by /launchkit/editor when the
// active family is Stacks. Same IDE chrome as the EVM/Solana editors (toolbar +
// file tree + editor + bottom tabs), with a Clarity language mode and a live
// Post-Condition Coverage panel (the differentiator).

import { useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import Editor from "@monaco-editor/react";
import {
  Rocket,
  Loader2,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Shield,
  CheckCircle2,
  Terminal as TerminalIcon,
  Files,
} from "lucide-react";
import { toast } from "sonner";
import { StacksWalletPanel } from "@/components/stacks/StacksWalletPanel";
import { StacksNetworkSelector } from "@/components/stacks/StacksNetworkSelector";
import { registerClarity } from "@/components/stacks/editor/clarity-language";
import { FileExplorer } from "@/components/shared/FileExplorer";
import { useCodeWorkspace } from "@/hooks/useCodeWorkspace";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { stacksExplorerLink } from "@/lib/stacks/chains";
import { STACKS_TEMPLATES, stacksTemplate } from "@/lib/stacks/templates";
import { auditSource, coverageLabel } from "@/lib/stacks/audit";
import { recordStacksDeploy } from "@/lib/stacks/deploy-history";
import { cn } from "@/lib/utils";

export function StacksEditorView() {
  const search = useSearch({ strict: false }) as { template?: string };
  const template = useMemo(() => stacksTemplate(search.template ?? "") ?? STACKS_TEMPLATES[0], [search.template]);

  const [name, setName] = useState(template.contractName);
  const ws = useCodeWorkspace({
    storageKey: "devstation-stacks-ws-v1",
    starterPath: `contracts/${template.contractName}.clar`,
    starterContent: template.clarity,
    newFileContent: () => "",
  });
  const code = ws.activeContent;
  const [mode, setMode] = useState<"deny" | "allow">("deny");
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>(["clarinet — DevStation for Stacks workspace ready."]);
  const [tab, setTab] = useState<"coverage" | "console">("coverage");
  const [filesOpen, setFilesOpen] = useState(false);

  const wallet = useStacksWallet();
  const audit = useMemo(
    () => auditSource(code, { postConditionMode: mode, declaredCount: template.postConditions ? 1 : 0, contractId: name }),
    [code, mode, name, template.postConditions],
  );
  const cov = coverageLabel(audit.coverage);

  // Lightweight "compile"/check: paren-balance + the post-condition audit
  // (a full `clarinet check` needs the Clarinet toolchain, which can't run in
  // the browser). Reports to the Console tab.
  const onCheck = () => {
    setTab("console");
    let bal = 0;
    let firstNeg = false;
    for (const ch of code) {
      if (ch === "(") bal++;
      else if (ch === ")") {
        bal--;
        if (bal < 0) firstNeg = true;
      }
    }
    const balanced = !firstNeg && bal === 0;
    const publics = (code.match(/\(define-public/g) ?? []).length;
    const reads = (code.match(/\(define-read-only/g) ?? []).length;
    setLog((l) => [
      ...l,
      "$ clarinet check",
      balanced ? "✓ Parentheses balanced" : "✗ Unbalanced parentheses — check your forms",
      `→ ${publics} public, ${reads} read-only function(s)`,
      `→ ${audit.transferPaths.length} asset-transfer path(s) · post-condition coverage: ${audit.coverage}`,
    ]);
  };

  const onDeploy = async () => {
    if (!wallet.connected) return toast.error("Connect a Stacks wallet first (Leather / Xverse).");
    setTxid(null);
    setTab("console");
    setLog((l) => [...l, `$ deploy ${name}`]);
    setBusy(true);
    try {
      const id = await wallet.deployContract({ name, code, postConditionMode: mode });
      setTxid(id);
      setLog((l) => [...l, `✓ Submitted: ${id}`]);
      recordStacksDeploy({
        kind: template.kind === "payment" ? "payment" : template.kind === "nft" ? "nft" : "token",
        network: wallet.network,
        contractName: `${wallet.address}.${name}`,
        txid: id,
        deployer: wallet.address ?? undefined,
        templateId: template.id,
        coverage: audit.coverage,
        timestamp: Math.floor(Date.now() / 1000),
      });
      toast.success("Contract deploy submitted");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Deploy failed";
      setLog((l) => [...l, `✗ ${msg}`]);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 0px)" }}>
      {/* Toolbar */}
      <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-border bg-[#0d1117] px-3">
        <button
          onClick={() => setFilesOpen((o) => !o)}
          className="rounded border border-border p-1 text-meta hover:text-foreground sm:hidden"
          title="Files"
        >
          <Files className="h-4 w-4" />
        </button>
        <span className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground">clarity</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value.replace(/[^a-z0-9-]/g, ""))}
          className="w-32 rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
        />
        <button
          onClick={onCheck}
          className="flex items-center gap-1 rounded border border-primary px-2.5 py-1 font-mono text-[11px] text-primary hover:bg-primary/10"
        >
          <CheckCircle2 className="h-3 w-3" /> Check
        </button>
        <button
          onClick={onDeploy}
          disabled={busy}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-mono text-[11px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Rocket className="h-3 w-3" />}
          {busy ? "Deploying…" : "Deploy"}
        </button>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
            cov.tone === "good" ? "border-success/40 text-success" : cov.tone === "warn" ? "border-warning/40 text-warning" : "border-danger/40 text-danger",
          )}
        >
          {cov.tone === "good" ? <ShieldCheck className="h-3 w-3" /> : cov.tone === "warn" ? <Shield className="h-3 w-3" /> : <ShieldAlert className="h-3 w-3" />}
          {cov.text}
        </span>
        <div className="flex-1" />
        <StacksNetworkSelector className="w-40" />
        <div className="hidden w-52 md:block">
          <StacksWalletPanel />
        </div>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {filesOpen && <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" onClick={() => setFilesOpen(false)} />}
        <aside
          className={cn(
            "shrink-0 border-r border-border bg-[#0d1117]",
            filesOpen ? "fixed inset-y-0 left-0 z-40 w-64 sm:static sm:z-auto sm:w-[210px]" : "hidden sm:block sm:w-[210px]",
          )}
        >
          <FileExplorer ws={ws} className="h-full" />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Editor
              height="100%"
              path={ws.activePath}
              language={ws.activePath.endsWith(".clar") ? "clarity" : ws.activePath.endsWith(".toml") ? "ini" : "plaintext"}
              theme="vs-dark"
              value={code}
              beforeMount={(monaco) => registerClarity(monaco)}
              onChange={(v) => ws.setActiveContent(v ?? "")}
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

          {/* Bottom: Coverage / Console */}
          <div className="flex h-[220px] shrink-0 flex-col border-t border-border bg-[#0a0e13]">
            <div className="flex items-center gap-1 border-b border-border px-2">
              <BottomTab active={tab === "coverage"} onClick={() => setTab("coverage")}>
                <ShieldCheck className="h-3 w-3" /> Post-Condition Coverage
              </BottomTab>
              <BottomTab active={tab === "console"} onClick={() => setTab("console")}>
                <TerminalIcon className="h-3 w-3" /> Console
              </BottomTab>
              {tab === "coverage" && (
                <label className="ml-auto flex items-center gap-1 pr-2 font-mono text-[10px] text-meta">
                  mode
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "deny" | "allow")}
                    className="rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-foreground"
                  >
                    <option value="deny">deny</option>
                    <option value="allow">allow</option>
                  </select>
                </label>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {tab === "console" ? (
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">{log.join("\n")}</pre>
              ) : (
                <div className="space-y-2">
                  {audit.transferPaths.length === 0 && (
                    <div className="font-mono text-[11px] text-meta">No asset-transfer paths found in this contract.</div>
                  )}
                  {audit.details.map((d, i) => (
                    <div key={i} className="rounded border border-border bg-background p-2 font-mono text-[10px]">
                      <div className="flex items-center gap-1.5">
                        <span className={d.status === "covered" ? "text-success" : d.status === "unknown-risk" ? "text-warning" : "text-danger"}>●</span>
                        <span className="text-foreground">{d.functionName}</span>
                        <span className="text-meta">· {d.assetType}</span>
                        <span className="ml-auto text-meta">{d.status}</span>
                      </div>
                      <div className="mt-1 text-muted-foreground">{d.note}</div>
                    </div>
                  ))}
                  {txid && (
                    <a
                      href={stacksExplorerLink(wallet.network, "txid", txid)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
                    >
                      View deploy tx <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-[#0d1117] p-2 md:hidden">
        <StacksWalletPanel />
      </div>
    </div>
  );
}

function BottomTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 border-b-2 px-2.5 py-1.5 font-mono text-[11px] transition",
        active ? "border-primary text-primary" : "border-transparent text-meta hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
