import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Download,
  ExternalLink,
  FileCode2,
  Link2,
  Loader2,
  Rocket,
  RotateCcw,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { PreviewFrame } from "@/components/appbuilder/PreviewFrame";
import { AttachContract } from "@/components/appbuilder/AttachContract";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { chainConfig, nativeSymbol } from "@/lib/chains";
import { generateApp } from "@/lib/appgen/generate";
import { blankScaffold } from "@/lib/appgen/prompt";
import { runTurn } from "@/lib/appgen/session";
import { validateApp } from "@/lib/appgen/validate";
import type { PreviewError } from "@/lib/appgen/preview";
import type { ResolvedAbi } from "@/lib/appgen/abi-source";
import { downloadZip } from "@/lib/appgen/zip";
import { isAiConfigured } from "@/lib/ai-settings";
import type { ChatMessage } from "@/lib/ai";

export const Route = createFileRoute("/launchkit/app-builder")({
  head: () => ({ meta: [{ title: "App Builder — DevStation" }] }),
  component: AppBuilderPage,
});

interface Turn {
  role: "user" | "assistant";
  text: string;
  changed?: string[];
  failed?: boolean;
}

function AppBuilderPage() {
  const { chainId } = useActiveChain();
  const writeFiles = useWorkspaceStore((s) => s.writeFiles);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const { address: wallet } = useAccount();

  const [turns, setTurns] = useState<Turn[]>([]);
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [attached, setAttached] = useState<ResolvedAbi | null>(null);
  const [previewErrors, setPreviewErrors] = useState<PreviewError[]>([]);
  const [deploying, setDeploying] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data: hosting } = useQuery({
    queryKey: ["apps-deploy-configured"],
    queryFn: async () => {
      const r = await fetch("/api/apps-deploy");
      return r.ok ? ((await r.json()) as { configured: boolean }) : { configured: false };
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, status]);

  const issues = useMemo(() => (files ? validateApp(files) : []), [files]);
  const fatal = issues.filter((i) => i.fatal);

  const send = useCallback(async () => {
    const prompt = input.trim();
    if (!prompt || busy) return;
    if (!isAiConfigured()) {
      toast.error("Add an API key in AI settings first.");
      return;
    }
    setInput("");
    setTurns((t) => [...t, { role: "user", text: prompt }]);
    setBusy(true);
    setStatus("Thinking…");
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // First turn starts from a runnable scaffold — with the contract's
      // binding baked in when one is attached — so even a partial reply
      // leaves something that loads.
      const base =
        files ??
        (attached
          ? generateApp({
              abi: attached.abi,
              address: attached.address,
              contractName: attached.name,
              chainId: attached.chainId,
              chainName: chainConfig(attached.chainId).name,
              rpcUrl: chainConfig(attached.chainId).rpcUrl,
              explorerUrl: chainConfig(attached.chainId).explorerUrl,
              nativeSymbol: nativeSymbol(attached.chainId),
            })
          : blankScaffold());

      const result = await runTurn({
        prompt,
        files: base,
        history,
        previewErrors,
        signal: controller.signal,
        onStatus: setStatus,
        onDelta: () => setStatus("Writing files…"),
        context: attached
          ? {
              contract: {
                address: attached.address,
                chainId: attached.chainId,
                chainName: chainConfig(attached.chainId).name,
                rpcUrl: chainConfig(attached.chainId).rpcUrl,
                explorerUrl: chainConfig(attached.chainId).explorerUrl,
                nativeSymbol: nativeSymbol(attached.chainId),
                abi: attached.abi,
              },
            }
          : {},
      });

      setFiles(result.files);
      setHistory(result.history);
      setPreviewErrors([]); // the app changed; old errors no longer apply
      writeFiles(Object.entries(result.files).map(([path, content]) => ({ path, content })));
      setTurns((t) => [
        ...t,
        {
          role: "assistant",
          text:
            result.reply ||
            (result.changed.length ? `Updated ${result.changed.length} file(s).` : "Done."),
          changed: result.changed,
          failed: result.issues.some((i) => i.fatal),
        },
      ]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setTurns((t) => [
          ...t,
          {
            role: "assistant",
            text: e instanceof Error ? e.message : "That failed.",
            failed: true,
          },
        ]);
      }
    } finally {
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
    }
  }, [input, busy, files, history, attached, previewErrors, writeFiles]);

  const publish = useCallback(async () => {
    if (!files) return;
    if (!wallet) {
      toast.error("Connect a wallet — deploys are rate limited per wallet.");
      return;
    }
    setDeploying(true);
    setLiveUrl(null);
    try {
      const payload: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        payload[path.replace(/^app\//, "")] = content;
      }
      const res = await fetch("/api/apps-deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ files: payload, requesterAddress: wallet }),
      });
      const json = (await res.json()) as { ok: boolean; url?: string; message?: string };
      if (!json.ok) {
        toast.error(json.message ?? "Deploy failed");
        return;
      }
      setLiveUrl(json.url ?? null);
      toast.success("Published");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }, [files, wallet]);

  const reset = () => {
    setTurns([]);
    setHistory([]);
    setFiles(null);
    setPreviewErrors([]);
    setLiveUrl(null);
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col lg:flex-row">
      {/* ───────── chat ───────── */}
      <div className="flex w-full shrink-0 flex-col border-b border-border lg:w-[420px] lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="font-mono text-xs font-bold text-foreground">App Builder</span>
          <div className="flex items-center gap-2">
            <AttachContract chainId={chainId} attached={attached} onAttach={setAttached} />
            {turns.length > 0 && (
              <button
                onClick={reset}
                title="Start over"
                className="text-meta transition hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
          {turns.length === 0 && (
            <div className="space-y-2 pt-6 text-center font-mono text-[11px] text-meta">
              <p className="text-sm text-muted-foreground">What do you want to build?</p>
              <p>Describe an app. It runs here as you go.</p>
              <p className="pt-2">Then keep talking to change it.</p>
            </div>
          )}
          {turns.map((t, i) => (
            <div
              key={i}
              className={
                t.role === "user"
                  ? "ml-6 rounded border border-border bg-surface-2 p-2 font-mono text-[11px] text-foreground"
                  : "mr-2 font-mono text-[11px] text-muted-foreground"
              }
            >
              {t.failed && (
                <span className="mb-1 flex items-center gap-1 text-warning">
                  <TriangleAlert className="h-3 w-3" /> needs another pass
                </span>
              )}
              <p className="whitespace-pre-wrap break-words">{t.text}</p>
              {t.changed && t.changed.length > 0 && (
                <p className="mt-1 text-[10px] text-meta">
                  {t.changed.map((c) => c.replace(/^app\//, "")).join(" · ")}
                </p>
              )}
            </div>
          ))}
          {status && (
            <p className="flex items-center gap-1.5 font-mono text-[11px] text-meta">
              <Loader2 className="h-3 w-3 animate-spin" /> {status}
            </p>
          )}
        </div>

        {fatal.length > 0 && (
          <button
            onClick={() => setInput("The preview is broken — fix it.")}
            className="mx-3 mb-2 rounded border border-danger/40 bg-danger/10 p-2 text-left font-mono text-[10px] text-danger"
          >
            {fatal[0].message} — click to ask for a fix
          </button>
        )}

        <div className="border-t border-border p-2">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={
                turns.length === 0
                  ? "Build me a token swap interface…"
                  : "Add a wallet connect button…"
              }
              className="flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
            {busy ? (
              <button
                onClick={() => abortRef.current?.abort()}
                title="Stop"
                className="rounded bg-surface-2 p-2 text-muted-foreground hover:text-foreground"
              >
                <Square className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!input.trim()}
                title="Send"
                className="rounded bg-primary p-2 text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ───────── preview ───────── */}
      <div className="flex min-h-0 flex-1 flex-col">
        {files && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-1.5">
            <button
              onClick={() => setShowFiles((v) => !v)}
              className="inline-flex items-center gap-1 font-mono text-[10px] text-meta hover:text-foreground"
            >
              <FileCode2 className="h-3 w-3" /> {Object.keys(files).length} files
            </button>
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => void downloadZip(files, "dapp.zip")}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              >
                <Download className="h-3 w-3" /> Download
              </button>
              {hosting?.configured && (
                <button
                  onClick={() => void publish()}
                  disabled={deploying}
                  className="inline-flex items-center gap-1 rounded border border-primary px-2 py-1 font-mono text-[10px] text-primary hover:bg-primary/10 disabled:opacity-40"
                >
                  {deploying ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Rocket className="h-3 w-3" />
                  )}
                  Publish
                </button>
              )}
              {liveUrl && (
                <a
                  href={liveUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[10px] text-success"
                >
                  <ExternalLink className="h-3 w-3" /> live
                </a>
              )}
            </div>
          </div>
        )}

        {showFiles && files && (
          <div className="max-h-40 overflow-y-auto border-b border-border bg-surface p-2">
            {Object.keys(files).map((p) => (
              <button
                key={p}
                onClick={() => openFile(p)}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[10px] text-meta hover:bg-surface-2 hover:text-foreground"
              >
                <Link2 className="h-2.5 w-2.5 shrink-0" /> {p}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1">
          {files ? (
            <PreviewFrame
              files={files}
              chainName={chainConfig(attached?.chainId ?? chainId).name}
              onError={(e) => setPreviewErrors((prev) => [...prev, e].slice(-20))}
              className="flex h-full flex-col"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-meta">
              Your app will appear here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
