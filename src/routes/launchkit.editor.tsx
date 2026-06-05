import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  File,
  Folder,
  ChevronRight,
  ChevronDown,
  GripHorizontal,
  Rocket,
  Play,
  Plus,
  X,
  Code2,
} from "lucide-react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { SolidityEditor } from "@/components/editor/SolidityEditor";
import { ClientOnly } from "@/components/shared/ClientOnly";
import { EditorTerminal } from "@/components/editor/EditorTerminal";
import { DeployPanel } from "@/components/editor/DeployPanel";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  compile,
  type CompileOutput,
  type CompileError,
  SOLC_VERSIONS,
  DEFAULT_SOLC_VERSION,
} from "@/lib/compiler";
import { WalletPanel } from "@/components/web3/WalletPanel";
import { qieTestnet, qieMainnet, QIE_DEX_SWAP_URL } from "@/lib/chains";
import { cn } from "@/lib/utils";
import type { TerminalLine } from "@/components/shared/TerminalOutput";

export const Route = createFileRoute("/launchkit/editor")({
  head: () => ({ meta: [{ title: "Contract Editor — DevStation" }] }),
  component: EditorPage,
});

function EditorPage() {
  const ws = useWorkspace();
  const { isConnected } = useAccount();

  const [version, setVersion] = useState(DEFAULT_SOLC_VERSION);
  const [autoCompile, setAutoCompile] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [lastResult, setLastResult] = useState<CompileOutput | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [lines, setLines] = useState<TerminalLine[]>(() => [
    { text: "[DevStation] Editor ready.", status: "success" },
    {
      text: `[DevStation] Open a .sol file to edit. Auto-compile runs 800ms after you stop typing.`,
      status: "pending",
    },
  ]);
  const [deployPanelOpen, setDeployPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const dragRef = useRef<number | null>(null);
  const [network, setNetwork] = useState<"testnet" | "mainnet">("testnet");
  const connectedChainId = network === "testnet" ? qieTestnet.id : qieMainnet.id;

  const activeSol = ws.activePath.endsWith(".sol") ? ws.activeContent : "";

  function logT(line: TerminalLine) {
    setLines((p) => [...p, line]);
  }

  const runCompile = useCallback(
    async (source?: string) => {
      const src = source ?? activeSol;
      if (!src.trim()) return;
      setCompiling(true);
      const ts = new Date().toLocaleTimeString();
      logT({
        text: `[${ts}] [Compiler] Compiling ${ws.activePath} with solc ${version}...`,
        status: "pending",
      });
      try {
        const sources: Record<string, string> = {};
        for (const f of ws.solFiles) {
          sources[f.path] = f.content;
        }
        const result = await compile({
          sources,
          version,
          mainFile: ws.activePath,
          optimize: false,
          optimizerRuns: 200,
        });
        setLastResult(result);
        if (result.status === "error") {
          for (const err of result.errors) {
            logT({ text: `[${ts}] [Error] ${err.formattedMessage}`, status: "error" });
          }
        } else {
          const count = Object.keys(result.contracts).length;
          logT({
            text: `[${ts}] [Compiler] ✓ Compiled successfully — ${count} contract${count !== 1 ? "s" : ""} (${result.timeMs}ms)`,
            status: "success",
          });
          for (const w of result.warnings) {
            logT({ text: `[${ts}] [Warning] ${w.formattedMessage}`, status: "warning" });
          }
        }
      } catch (err) {
        logT({
          text: `[${ts}] [Error] ${err instanceof Error ? err.message : "Compilation failed"}`,
          status: "error",
        });
      } finally {
        setCompiling(false);
      }
    },
    [activeSol, ws.activePath, ws.solFiles, version],
  );

  // Auto-compile on content change (debounced 800ms)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!autoCompile || !activeSol.trim()) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runCompile(activeSol), 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [activeSol, autoCompile, runCompile]);

  // Terminal resize drag
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = e.clientY;
    const onMove = (ev: PointerEvent) => {
      if (dragRef.current === null) return;
      const delta = dragRef.current - ev.clientY;
      setTerminalHeight((h) => Math.min(Math.max(h + delta, 80), window.innerHeight * 0.6));
      dragRef.current = ev.clientY;
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, []);

  const toggleTerminal = () => setTerminalCollapsed((c) => !c);

  const resetTermHeight = () => setTerminalHeight(220);

  const clearTerminal = () => setLines([]);

  const diagnostics: CompileError[] = useMemo(() => {
    if (!lastResult) return [];
    return [...lastResult.errors, ...lastResult.warnings].filter((e) => e.sourceLocation);
  }, [lastResult]);

  const contracts = lastResult?.status === "success" ? lastResult.contracts : null;

  return (
    <div className="flex flex-col overflow-hidden" style={{ height: "calc(100vh - 0px)" }}>
      {/* === TOOLBAR === */}
      <div className="flex h-[44px] shrink-0 items-center gap-3 border-b border-border bg-[#0d1117] px-3">
        {/* Compiler version */}
        <select
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
        >
          {SOLC_VERSIONS.map((v) => (
            <option key={v} value={v}>
              solc {v}
            </option>
          ))}
        </select>

        {/* Auto-compile */}
        <label className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-meta">
          <input
            type="checkbox"
            checked={autoCompile}
            onChange={(e) => setAutoCompile(e.target.checked)}
            className="h-3 w-3"
          />
          Auto
        </label>

        {/* Compile button */}
        <button
          onClick={() => runCompile()}
          disabled={compiling || !activeSol.trim()}
          className="flex items-center gap-1 rounded border border-primary px-2.5 py-1 font-mono text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40"
        >
          <Play className="h-3 w-3" />
          Compile
        </button>

        <span className="mx-1 h-4 w-px bg-border" />

        {/* Deploy button */}
        <button
          onClick={() => setDeployPanelOpen(true)}
          disabled={!contracts || !isConnected}
          className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 font-mono text-[11px] font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
        >
          <Rocket className="h-3 w-3" /> Compile & Deploy
        </button>

        <div className="flex-1" />

        {/* Active file */}
        <span className="font-mono text-[11px] text-muted-foreground">{ws.activePath}</span>

        <div className="flex-1" />

        {/* Network */}
        <select
          value={network}
          onChange={(e) => setNetwork(e.target.value as "testnet" | "mainnet")}
          className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground"
        >
          <option value="testnet">● QIE Testnet</option>
          <option value="mainnet">● QIE Mainnet</option>
        </select>

        {/* Wallet status */}
        <WalletPanel />
      </div>

      {/* Mainnet warning */}
      {network === "mainnet" && (
        <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-3 py-1 font-mono text-[11px] text-warning">
          ⚠ QIE Mainnet. Transactions cost real gas.
        </div>
      )}

      {/* === PANELS === */}
      <div className="flex flex-1 overflow-hidden">
        {/* File explorer */}
        {!sidebarCollapsed && (
          <aside className="flex w-[200px] shrink-0 flex-col border-r border-border bg-[#0d1117]">
            <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Files
              </span>
              <div className="flex gap-0.5">
                <button
                  onClick={() => ws.createFile("contracts")}
                  title="New file"
                  className="rounded p-1 text-meta hover:text-foreground"
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="rounded p-1 text-meta hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-1 py-1">
              <FileTree
                node={ws.tree}
                activePath={ws.activePath}
                onOpen={ws.openFile}
                onDelete={ws.deleteFile}
                onRename={ws.renameFile}
                onCreate={ws.createFile}
              />
            </div>
          </aside>
        )}

        {/* Editor area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {sidebarCollapsed && (
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="flex items-center gap-1 border-b border-border px-2 py-1 font-mono text-[10px] text-meta hover:text-foreground"
            >
              <Folder className="h-3 w-3" /> Show files
            </button>
          )}
          <div className="flex-1 overflow-hidden">
            {ws.activePath.endsWith(".sol") ? (
              <ClientOnly
                fallback={
                  <div className="flex h-full items-center justify-center font-mono text-xs text-meta">
                    Loading editor…
                  </div>
                }
              >
                <SolidityEditor
                  value={activeSol}
                  filename={ws.activePath}
                  onChange={(v) => ws.setContent(ws.activePath, v)}
                  diagnostics={diagnostics}
                />
              </ClientOnly>
            ) : (
              <div className="flex h-full items-center justify-center font-mono text-xs text-muted-foreground">
                {ws.activePath ? `${ws.activePath} (not a .sol file)` : "Select a file to edit"}
              </div>
            )}
          </div>

          {/* Terminal resize handle */}
          <div
            onPointerDown={onPointerDown}
            onDoubleClick={resetTermHeight}
            className="flex h-[6px] shrink-0 cursor-row-resize items-center justify-center bg-[#1e2a38] hover:bg-primary/30"
          >
            <GripHorizontal className="h-3 w-3 text-meta" />
          </div>

          {/* Terminal */}
          {!terminalCollapsed && (
            <div style={{ height: terminalHeight }} className="shrink-0">
              <EditorTerminal lines={lines} onClear={clearTerminal} onCollapse={toggleTerminal} />
            </div>
          )}
          {terminalCollapsed && (
            <div
              className="flex h-[28px] shrink-0 cursor-pointer items-center justify-between border-t border-border bg-[#0a0e13] px-3"
              onClick={toggleTerminal}
            >
              <span className="font-mono text-[10px] uppercase tracking-wider text-meta">
                TERMINAL
              </span>
              <span className="font-mono text-[10px] text-meta">click to expand</span>
            </div>
          )}
        </div>
      </div>

      {/* Deploy slide-in panel */}
      {deployPanelOpen && contracts && (
        <DeployPanel
          contracts={contracts}
          chainId={connectedChainId}
          onClose={() => setDeployPanelOpen(false)}
          onLog={logT}
        />
      )}
    </div>
  );
}

/* ── File Tree ── */
function FileTree({
  node,
  depth = 0,
  activePath,
  onOpen,
  onDelete,
  onRename,
  onCreate,
}: {
  node: {
    type: "dir" | "file";
    path: string;
    children?: Array<{ type: "dir" | "file"; path: string; children?: unknown[] }>;
  };
  depth?: number;
  activePath: string;
  onOpen: (p: string) => void;
  onDelete: (p: string) => void;
  onRename: (oldP: string, newP: string) => void;
  onCreate: (p: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const name = node.path.split("/").pop() ?? node.path;
  const isDir = node.type === "dir";
  const pad = { paddingLeft: depth * 12 + 4 };

  if (isDir && (!node.children || node.children.length === 0) && node.path !== "") return null;

  return (
    <div>
      <div
        className={cn(
          "flex cursor-pointer items-center gap-1 rounded px-1 py-1 font-mono text-[11px] transition hover:bg-[#161b22]",
          node.path === activePath && "bg-[#1e2a38]",
        )}
        style={pad}
        onClick={() => (isDir ? setOpen((o) => !o) : onOpen(node.path))}
      >
        {isDir &&
          (open ? (
            <ChevronDown className="h-3 w-3 text-meta" />
          ) : (
            <ChevronRight className="h-3 w-3 text-meta" />
          ))}
        {isDir ? (
          <Folder className="h-3 w-3 text-amber-500" />
        ) : (
          <Code2 className="h-3 w-3 text-info" />
        )}
        <span className="truncate text-foreground">{name}</span>
      </div>
      {open &&
        isDir &&
        (node.children ?? []).map((child) => (
          <FileTree
            key={child.path}
            node={
              child as {
                type: "dir" | "file";
                path: string;
                children?: Array<{ type: "dir" | "file"; path: string; children?: unknown[] }>;
              }
            }
            depth={depth + 1}
            activePath={activePath}
            onOpen={onOpen}
            onDelete={onDelete}
            onRename={onRename}
            onCreate={onCreate}
          />
        ))}
    </div>
  );
}
