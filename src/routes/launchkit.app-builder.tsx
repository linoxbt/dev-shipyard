import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { Wand2, Download, Loader2, ExternalLink, FileCode2, Rocket } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { PreviewFrame } from "@/components/appbuilder/PreviewFrame";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { chainConfig, nativeSymbol } from "@/lib/chains";
import { generateApp, type GenerateSpec } from "@/lib/appgen/generate";
import { fromPasted, resolveAbi, type ResolvedAbi } from "@/lib/appgen/abi-source";
import { downloadZip } from "@/lib/appgen/zip";
import { appBuilderSystemPrompt, blankScaffold, parseGeneratedFiles } from "@/lib/appgen/prompt";
import { chatStream } from "@/lib/ai";
import { isAiConfigured } from "@/lib/ai-settings";
import { storage } from "@/lib/storage";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/launchkit/app-builder")({
  head: () => ({ meta: [{ title: "App Builder — DevStation" }] }),
  component: AppBuilderPage,
});

type Mode = "prompt" | "deployed" | "address" | "paste";

function AppBuilderPage() {
  const { chainId, chain } = useActiveChain();
  const writeFiles = useWorkspaceStore((s) => s.writeFiles);
  const openFile = useWorkspaceStore((s) => s.openFile);

  const [mode, setMode] = useState<Mode>("prompt");
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState("");
  const [address, setAddress] = useState("");
  const [abiJson, setAbiJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string> | null>(null);
  const [resolved, setResolved] = useState<ResolvedAbi | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [ownToken, setOwnToken] = useState("");
  const [showOwnHost, setShowOwnHost] = useState(false);
  const { address: wallet } = useAccount();

  // Is DevStation-hosted publishing available on this deployment?
  const { data: hosting } = useQuery({
    queryKey: ["apps-deploy-configured"],
    queryFn: async () => {
      const r = await fetch("/api/apps-deploy");
      return r.ok ? ((await r.json()) as { configured: boolean }) : { configured: false };
    },
    staleTime: 60_000,
    retry: false,
  });

  // Contracts deployed from this browser, newest first.
  const deployed = useMemo(
    () =>
      storage
        .loadProjects()
        .filter((p) => p.address && Array.isArray(p.abi) && p.abi.length > 0)
        .sort((a, b) => (b.deployedAt ?? 0) - (a.deployedAt ?? 0)),
    [],
  );

  const build = useCallback(
    (info: ResolvedAbi) => {
      const cfg = chainConfig(info.chainId);
      const spec: GenerateSpec = {
        abi: info.abi,
        address: info.address,
        contractName: info.name,
        chainId: info.chainId,
        chainName: cfg.name,
        rpcUrl: cfg.rpcUrl,
        explorerUrl: cfg.explorerUrl,
        nativeSymbol: nativeSymbol(info.chainId),
      };
      const generated = generateApp(spec);
      setFiles(generated);
      setResolved(info);
      // Land the project in the workspace so it can be edited or refined,
      // without stealing focus from whatever file is currently open.
      writeFiles(Object.entries(generated).map(([path, content]) => ({ path, content })));
      toast.success(`Generated ${Object.keys(generated).length} files in /app`);
    },
    [writeFiles],
  );

  // Free-form build: describe an app and the model writes it. A contract is
  // OPTIONAL — when one is attached, its binding is still generated
  // deterministically and the model is told to import it rather than invent it.
  const generateFromPrompt = useCallback(async () => {
    if (!prompt.trim()) return;
    if (!isAiConfigured()) {
      setError("The AI assistant needs an API key. Open AI settings on the Code with AI page.");
      return;
    }
    setBusy(true);
    setError(null);
    setStreaming("");
    try {
      let attached: ResolvedAbi | null = null;
      if (address.trim()) {
        const r = await resolveAbi(address.trim(), chainId);
        if (r.ok) attached = r.value;
      }

      // Start from a scaffold that already runs, so a partial or malformed
      // response still leaves something loadable rather than a blank frame.
      const base: Record<string, string> = attached
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
        : blankScaffold();

      const system = appBuilderSystemPrompt(
        attached
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
      );

      const reply = await chatStream({
        system,
        messages: [{ role: "user", content: prompt.trim() }],
        onDelta: (c) => setStreaming((prev) => prev + c),
      });

      const written = parseGeneratedFiles(reply);
      if (written.length === 0) {
        setError("The model did not return any files. Try describing the app more concretely.");
        return;
      }
      const merged = { ...base };
      for (const f of written) {
        // contract.js is generated from the contract; never model-written.
        if (/(^|\/)contract\.js$/.test(f.path)) continue;
        merged[f.path] = f.content;
      }
      setFiles(merged);
      setResolved(
        attached ?? {
          abi: [],
          address: "0x0000000000000000000000000000000000000000",
          chainId,
          name: "App",
          source: "pasted",
          verified: false,
        },
      );
      writeFiles(Object.entries(merged).map(([path, content]) => ({ path, content })));
      toast.success(`Built ${written.length} file${written.length === 1 ? "" : "s"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the app.");
    } finally {
      setBusy(false);
      setStreaming("");
    }
  }, [prompt, address, chainId, writeFiles]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === "paste"
          ? fromPasted(address.trim(), chainId, abiJson)
          : await resolveAbi(address.trim(), chainId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      build(result.value);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the app.");
    } finally {
      setBusy(false);
    }
  }, [mode, address, abiJson, chainId, build]);

  const onDownload = useCallback(async () => {
    if (!files || !resolved) return;
    try {
      await downloadZip(files, `${resolved.name ?? "dapp"}.zip`.replace(/[^\w.-]+/g, "-"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  }, [files, resolved]);

  const publish = useCallback(async () => {
    if (!files || !resolved) return;
    if (!wallet) {
      toast.error("Connect a wallet first — deploys are rate limited per wallet.");
      return;
    }
    setDeploying(true);
    setLiveUrl(null);
    try {
      // Site files live at the root, so strip the workspace directory prefix.
      const payload: Record<string, string> = {};
      for (const [path, content] of Object.entries(files)) {
        payload[path.replace(/^app\//, "")] = content;
      }
      const res = await fetch("/api/apps-deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          files: payload,
          requesterAddress: wallet,
          name: (resolved.name ?? "dapp")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .slice(0, 40),
          ownToken: ownToken.trim() || undefined,
        }),
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
  }, [files, resolved, wallet, ownToken]);

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "App Builder"]}
        title="App Builder"
        subtitle="Turn a deployed contract into a working web app — preview it live, then download or deploy it."
      />

      <div className="grid gap-4 p-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <div className="rounded border border-border bg-surface">
            <div className="flex border-b border-border">
              {(
                [
                  ["prompt", "Describe it"],
                  ["deployed", "My deploys"],
                  ["address", "Any address"],
                  ["paste", "Paste ABI"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => {
                    setMode(id);
                    setError(null);
                  }}
                  className={`flex-1 px-3 py-2 font-mono text-[11px] transition ${
                    mode === id
                      ? "border-b-2 border-primary text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-3 p-3">
              {mode === "prompt" && (
                <>
                  <label className="block space-y-1">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      What should the app do?
                    </span>
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      rows={6}
                      placeholder="A staking dashboard with a dark theme, showing my balance, a stake form and recent activity"
                      className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Contract address (optional)
                    </span>
                    <input
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="0x… — leave empty for an app with no contract"
                      className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                    />
                  </label>
                  {busy && streaming && (
                    <pre className="max-h-32 overflow-y-auto rounded border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-meta">
                      {streaming.slice(-600)}
                    </pre>
                  )}
                </>
              )}

              {mode === "deployed" && (
                <>
                  {deployed.length === 0 ? (
                    <p className="font-mono text-xs text-meta">
                      Nothing deployed from this browser yet. Deploy a contract, or use “Any
                      address”.
                    </p>
                  ) : (
                    <div className="max-h-72 space-y-1 overflow-y-auto">
                      {deployed.map((p) => (
                        <button
                          key={p.txHash}
                          onClick={() => setAddress(p.address)}
                          className={`w-full rounded border px-2 py-1.5 text-left font-mono text-[11px] transition ${
                            address.toLowerCase() === p.address.toLowerCase()
                              ? "border-primary bg-primary/10"
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <span className="block truncate text-foreground">
                            {p.name || p.templateName || "Contract"}
                          </span>
                          <span className="block truncate text-meta">{p.address}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}

              {mode !== "deployed" && (
                <label className="block space-y-1">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Contract address
                  </span>
                  <input
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="0x…"
                    className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              )}

              {mode === "paste" && (
                <label className="block space-y-1">
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ABI (array, or a build artifact)
                  </span>
                  <textarea
                    value={abiJson}
                    onChange={(e) => setAbiJson(e.target.value)}
                    rows={8}
                    placeholder='[{"type":"function", ...}]'
                    className="w-full resize-y rounded border border-border bg-background px-2 py-1.5 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
                  />
                </label>
              )}

              {mode === "address" && (
                <p className="font-mono text-[10px] text-meta">
                  The contract must be verified on {chain.name} so its ABI can be read.
                </p>
              )}

              {error && (
                <p className="rounded border border-danger/40 bg-danger/10 p-2 font-mono text-[11px] text-danger">
                  {error}
                </p>
              )}

              <button
                onClick={() => void (mode === "prompt" ? generateFromPrompt() : generate())}
                disabled={busy || (mode === "prompt" ? !prompt.trim() : !address.trim())}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="h-3.5 w-3.5" />
                )}
                {busy ? "Building…" : mode === "prompt" ? "Build App" : "Generate App"}
              </button>
            </div>
          </div>

          {files && resolved && (
            <div className="space-y-2 rounded border border-border bg-surface p-3">
              <div className="font-mono text-[11px] text-muted-foreground">
                {Object.keys(files).length} files · {resolved.abi.length} ABI entries · via{" "}
                {resolved.source}
              </div>
              <div className="space-y-0.5">
                {Object.keys(files).map((p) => (
                  <button
                    key={p}
                    onClick={() => openFile(p)}
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[11px] text-meta hover:bg-surface-2 hover:text-foreground"
                  >
                    <FileCode2 className="h-3 w-3 shrink-0" />
                    {p}
                  </button>
                ))}
              </div>
              <div className="space-y-2 border-t border-border pt-2">
                {hosting?.configured || showOwnHost ? (
                  <>
                    {showOwnHost && (
                      <label className="block space-y-1">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          Your Netlify personal access token
                        </span>
                        <input
                          type="password"
                          value={ownToken}
                          onChange={(e) => setOwnToken(e.target.value)}
                          placeholder="nfp_…"
                          className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground focus:border-primary focus:outline-none"
                        />
                        <span className="block text-[10px] text-meta">
                          Sent to the deploy endpoint for this request only; never stored.
                        </span>
                      </label>
                    )}
                    <button
                      onClick={() => void publish()}
                      disabled={deploying || (showOwnHost && !ownToken.trim())}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded border border-primary px-3 py-1.5 font-mono text-[11px] text-primary hover:bg-primary/10 disabled:opacity-40"
                    >
                      {deploying ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Rocket className="h-3 w-3" />
                      )}
                      {deploying
                        ? "Publishing…"
                        : showOwnHost
                          ? "Publish to my account"
                          : "Publish to a live URL"}
                    </button>
                  </>
                ) : (
                  <p className="font-mono text-[10px] text-meta">
                    DevStation hosting is not configured on this deployment.
                  </p>
                )}
                <button
                  onClick={() => setShowOwnHost((v) => !v)}
                  className="w-full text-center font-mono text-[10px] text-meta underline hover:text-foreground"
                >
                  {showOwnHost ? "Use DevStation hosting" : "Deploy to my own Netlify account"}
                </button>
                {liveUrl && (
                  <a
                    href={liveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-center gap-1.5 rounded border border-success/40 bg-success/10 px-3 py-1.5 font-mono text-[11px] text-success"
                  >
                    <ExternalLink className="h-3 w-3" /> {liveUrl.replace(/^https:\/\//, "")}
                  </a>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void onDownload()}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  <Download className="h-3 w-3" /> Download .zip
                </button>
                <a
                  href={`${chainConfig(resolved.chainId).explorerUrl.replace(/\/$/, "")}/address/${resolved.address}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-[560px] overflow-hidden rounded border border-border bg-surface">
          {files && resolved ? (
            <PreviewFrame
              files={files}
              chainName={chainConfig(resolved.chainId).name}
              className="flex h-[70vh] flex-col"
            />
          ) : (
            <div className="flex h-[70vh] items-center justify-center p-6 text-center font-mono text-xs text-meta">
              Pick a contract and generate an app — it will run here, against the live chain.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
