// Solana variant of the Contract Editor — rendered by /launchkit/editor when the
// active chain family is Solana. Its UI mirrors the EVM editor (toolbar + file
// explorer + editor + bottom Terminal/Inspector tabs). It builds/deploys Anchor
// programs and lets a user INITIALIZE an already-deployed program by loading its
// program id + IDL. Same look as the EVM side; Solana-specific behavior.

import { useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import Editor from "@monaco-editor/react";
import {
  Rocket,
  Loader2,
  ExternalLink,
  CheckCircle2,
  Hammer,
  Info,
  Wand2,
  FolderInput,
  Terminal as TerminalIcon,
  Search,
  Files,
} from "lucide-react";
import { toast } from "sonner";
import { SolanaWalletPanel } from "@/components/solana/SolanaWalletPanel";
import { SolanaClusterSelector } from "@/components/solana/SolanaClusterSelector";
import { ProgramInteract } from "@/components/solana/editor/ProgramInteract";
import { FileExplorer } from "@/components/shared/FileExplorer";
import { useCodeWorkspace } from "@/hooks/useCodeWorkspace";
import { useSolanaDeploy, type ProgramDeployResult } from "@/lib/solana/deploy";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { solanaExplorerLink } from "@/lib/solana/chains";
import { SOLANA_TEMPLATES, solanaTemplate } from "@/lib/solana/templates";
import { recordSolanaDeploy } from "@/lib/solana/deploy-history";
import { cn } from "@/lib/utils";

const DEFAULT_SOURCE =
  SOLANA_TEMPLATES.find((t) => t.kind === "program")?.source ?? "// Write your Anchor program here\n";

export function SolanaEditorView() {
  const search = useSearch({ strict: false }) as { template?: string };
  const initialSource = useMemo(() => {
    const t = search.template ? solanaTemplate(search.template) : undefined;
    return t?.source ?? DEFAULT_SOURCE;
  }, [search.template]);

  const ws = useCodeWorkspace({
    storageKey: "devstation-solana-ws-v1",
    starterPath: "programs/my_program/src/lib.rs",
    starterContent: initialSource,
    newFileContent: () => "",
  });
  const source = ws.activeContent;
  const [busy, setBusy] = useState<"idle" | "building" | "deploying">("idle");
  const [result, setResult] = useState<ProgramDeployResult | null>(null);
  const [log, setLog] = useState<string[]>(["$ anchor — DevStation Solana workspace ready."]);
  const [bottomTab, setBottomTab] = useState<"terminal" | "inspector">("terminal");
  const [filesOpen, setFilesOpen] = useState(false);

  const deploy = useSolanaDeploy();
  const wallet = useSolanaWallet();

  const append = (line: string) => setLog((l) => [...l, line]);

  const onBuildDeploy = async () => {
    if (!deploy.ready) return toast.error("Connect or unlock a Solana wallet first.");
    if (!deploy.remoteBuildEnabled) {
      append("✗ Build service not configured (set VITE_SOLANA_BUILD_API).");
      setBottomTab("terminal");
      return toast.error("Custom-program builds need VITE_SOLANA_BUILD_API. Deploy a token/NFT template instead.");
    }
    setResult(null);
    setBottomTab("terminal");
    try {
      setBusy("building");
      append("$ anchor build");
      const built = await deploy.buildProgram(source, "anchor");
      append("✓ Build succeeded → program.so");
      setBusy("deploying");
      append("$ anchor deploy");
      const res = await deploy.deployProgram(built.soBytes, built.idl);
      append(`✓ Deployed: ${res.programId}`);
      setResult(res);
      recordSolanaDeploy({
        kind: "program",
        cluster: wallet.cluster,
        address: res.programId,
        name: "Anchor program",
        templateId: "anchor-program",
        wallet: wallet.address ?? undefined,
        timestamp: Math.floor(Date.now() / 1000),
      });
      setBottomTab("inspector");
      toast.success("Program deployed to Solana");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Build/deploy failed";
      append(`✗ ${msg}`);
      toast.error(msg);
    } finally {
      setBusy("idle");
    }
  };

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 0px)" }}>
      {/* === TOOLBAR === */}
      <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-border bg-[#0d1117] px-3">
        <button
          onClick={() => setFilesOpen((o) => !o)}
          className="rounded border border-border p-1 text-meta hover:text-foreground sm:hidden"
          title="Files"
        >
          <Files className="h-4 w-4" />
        </button>
        <span className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground">
          anchor 0.30
        </span>
        <button
          onClick={onBuildDeploy}
          disabled={busy !== "idle" || !deploy.remoteBuildEnabled}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-mono text-[11px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
        >
          {busy === "building" ? (
            <Hammer className="h-3 w-3 animate-pulse" />
          ) : busy === "deploying" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Rocket className="h-3 w-3" />
          )}
          {busy === "idle" ? "Build & Deploy" : busy === "building" ? "Building…" : "Deploying…"}
        </button>

        <div className="flex-1" />
        <span className="hidden truncate font-mono text-[11px] text-muted-foreground sm:block">
          {ws.activePath}
        </span>
        <div className="flex-1" />

        <SolanaClusterSelector className="w-40" />
        <div className="hidden w-56 md:block">
          <SolanaWalletPanel />
        </div>
      </div>

      {/* === PANELS === */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* File explorer (desktop rail + mobile drawer) */}
        {filesOpen && <div className="fixed inset-0 z-30 bg-black/50 sm:hidden" onClick={() => setFilesOpen(false)} />}
        <aside
          className={cn(
            "shrink-0 border-r border-border bg-[#0d1117]",
            filesOpen ? "fixed inset-y-0 left-0 z-40 w-64 sm:static sm:z-auto sm:w-[210px]" : "hidden sm:block sm:w-[210px]",
          )}
        >
          <FileExplorer ws={ws} className="h-full" />
        </aside>

        {/* Editor column */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Editor
              height="100%"
              path={ws.activePath}
              language={langFor(ws.activePath)}
              theme="vs-dark"
              value={source}
              onChange={(v) => ws.setActiveContent(v ?? "")}
              options={{
                fontSize: 13,
                fontFamily: "'JetBrains Mono', 'Courier New', monospace",
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "on",
                tabSize: 4,
                automaticLayout: true,
                padding: { top: 12 },
              }}
            />
          </div>

          {/* Bottom panel: Terminal / Inspector tabs (like the EVM editor) */}
          <div className="flex h-[210px] shrink-0 flex-col border-t border-border bg-[#0a0e13]">
            <div className="flex items-center gap-1 border-b border-border px-2">
              <BottomTab active={bottomTab === "terminal"} onClick={() => setBottomTab("terminal")}>
                <TerminalIcon className="h-3 w-3" /> Terminal
              </BottomTab>
              <BottomTab active={bottomTab === "inspector"} onClick={() => setBottomTab("inspector")}>
                <Search className="h-3 w-3" /> Inspector
              </BottomTab>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {bottomTab === "terminal" ? (
                <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {log.join("\n")}
                </pre>
              ) : (
                <div className="space-y-3">
                  {!deploy.remoteBuildEnabled && (
                    <div className="flex items-start gap-2 rounded border border-border bg-surface-2 p-2.5 font-mono text-[11px] text-muted-foreground">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-meta" />
                      <span>
                        Arbitrary Rust/Anchor builds require <code>VITE_SOLANA_BUILD_API</code>. Token
                        &amp; NFT templates deploy in-browser without it.
                      </span>
                    </div>
                  )}
                  {result && (
                    <div className="space-y-1 rounded border border-success/40 bg-success/10 p-2.5 font-mono text-[11px]">
                      <div className="flex items-center gap-2 text-success">
                        <CheckCircle2 className="h-4 w-4" /> Program deployed
                      </div>
                      <a
                        href={solanaExplorerLink(wallet.cluster, "address", result.programId)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 truncate text-primary hover:underline"
                      >
                        {result.programId} <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                  )}
                  {result && <ProgramInteract programId={result.programId} idl={result.idl} />}
                  <LoadDeployedProgram />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Wallet on small screens (toolbar wallet is hidden below md) */}
      <div className="border-t border-border bg-[#0d1117] p-2 md:hidden">
        <SolanaWalletPanel />
      </div>
    </div>
  );
}

function langFor(path: string): string {
  if (path.endsWith(".rs")) return "rust";
  if (path.endsWith(".toml")) return "ini";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
  return "plaintext";
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

// Initialize/interact with a program deployed earlier on DevStation by pasting
// its program id + IDL JSON.
function LoadDeployedProgram() {
  const [programId, setProgramId] = useState("");
  const [idlText, setIdlText] = useState("");
  const [loaded, setLoaded] = useState<{ programId: string; idl: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    if (!programId.trim()) return setError("Enter the deployed program id.");
    let idl: unknown = undefined;
    if (idlText.trim()) {
      try {
        idl = JSON.parse(idlText);
      } catch {
        return setError("IDL is not valid JSON.");
      }
    }
    setLoaded({ programId: programId.trim(), idl });
  };

  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 font-mono text-xs font-bold text-foreground">
        <Wand2 className="h-3.5 w-3.5 text-primary" /> Initialize a Deployed Program
      </div>
      <div className="space-y-2 p-3">
        <p className="font-mono text-[10px] text-meta">
          Paste a program id you deployed on DevStation (+ its IDL JSON) to initialize and call its
          instructions.
        </p>
        <input
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          placeholder="Program id (base58)"
          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
        />
        <textarea
          value={idlText}
          onChange={(e) => setIdlText(e.target.value)}
          rows={3}
          placeholder="IDL JSON (optional but needed to introspect instructions)"
          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
        />
        {error && <div className="font-mono text-[10px] text-danger">{error}</div>}
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded border border-primary px-2.5 py-1 font-mono text-[11px] text-primary hover:bg-primary/10"
        >
          <FolderInput className="h-3 w-3" /> Load program
        </button>
      </div>
      {loaded && (
        <div className="border-t border-border p-3">
          <ProgramInteract programId={loaded.programId} idl={loaded.idl} />
        </div>
      )}
    </div>
  );
}
