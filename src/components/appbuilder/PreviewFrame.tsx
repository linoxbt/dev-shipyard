import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnectorClient } from "wagmi";
import { buildPreview, PREVIEW_ERROR_TAG, type PreviewError } from "@/lib/appgen/preview";

// Live preview of a generated app.
//
// The iframe is sandboxed WITHOUT allow-same-origin, so the page inside cannot
// reach DevStation's DOM, storage or wallet directly. Instead the generated
// app's wallet.js detects that it is embedded and forwards wallet calls over
// postMessage; this component answers them using the wallet the developer has
// already connected. That means no second connect flow, and a much smaller
// surface than handing an iframe a provider.
//
// Only the methods below are answered. Reads never come through here — the
// generated app talks to the RPC directly for those.
const BRIDGE_TAG = "devstation-app-bridge";

const ALLOWED_METHODS = new Set([
  "eth_requestAccounts",
  "eth_accounts",
  "eth_chainId",
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
]);

interface Props {
  files: Record<string, string>;
  dir?: string;
  /** Chain the app was generated for, shown so it is obvious what a
   *  transaction from the preview would actually touch. */
  chainName: string;
  /** Errors the running app reported. Without this a failed module is just a
   *  white frame — invisible to the user and to the agent trying to fix it. */
  onError?: (error: PreviewError) => void;
  className?: string;
}

export function PreviewFrame({ files, dir = "app", chainName, onError, className }: Props) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeErrors, setRuntimeErrors] = useState<PreviewError[]>([]);
  const { isConnected } = useAccount();
  const { data: connectorClient } = useConnectorClient();

  // Rebuild whenever the files change, and revoke the previous blob URLs.
  const bundle = useMemo(() => {
    try {
      setError(null);
      return buildPreview(files, dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the preview.");
      return null;
    }
  }, [files, dir]);

  useEffect(() => () => bundle?.revoke(), [bundle]);
  // A rebuilt app starts from a clean slate.
  useEffect(() => setRuntimeErrors([]), [bundle]);

  // Errors reported from inside the preview.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { tag?: string; error?: PreviewError } | undefined;
      if (!msg || msg.tag !== PREVIEW_ERROR_TAG || !msg.error) return;
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      setRuntimeErrors((prev) =>
        prev.some((p) => p.message === msg.error!.message) ? prev : [...prev, msg.error!],
      );
      onError?.(msg.error);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onError]);

  // Answer wallet requests coming from the preview.
  useEffect(() => {
    const onMessage = async (event: MessageEvent) => {
      const msg = event.data as
        | { tag?: string; kind?: string; id?: number; method?: string; params?: unknown[] }
        | undefined;
      if (!msg || msg.tag !== BRIDGE_TAG || msg.kind !== "request") return;
      // Only answer our own iframe, never any other frame on the page.
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;

      const reply = (body: { result?: unknown; error?: string }) =>
        frame.contentWindow?.postMessage(
          { tag: BRIDGE_TAG, kind: "result", id: msg.id, ...body },
          "*",
        );

      const method = msg.method ?? "";
      if (!ALLOWED_METHODS.has(method)) {
        reply({ error: `Method not allowed from a preview: ${method}` });
        return;
      }
      const provider = connectorClient?.transport as
        | { request?: (args: { method: string; params?: unknown[] }) => Promise<unknown> }
        | undefined;
      if (!provider?.request) {
        reply({ error: "Connect a wallet in DevStation to use the preview." });
        return;
      }
      try {
        reply({ result: await provider.request({ method, params: msg.params ?? [] }) });
      } catch (e) {
        const err = e as { shortMessage?: string; message?: string };
        reply({ error: err.shortMessage ?? err.message ?? "The wallet rejected that request." });
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [connectorClient]);

  return (
    <div className={className}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-1.5 font-mono text-[11px]">
        <span className="text-meta">Live preview</span>
        <span className="flex items-center gap-2">
          {/* Transactions from here are real. Say which chain, plainly. */}
          <span className="text-warning">{chainName}</span>
          <span className="text-meta">
            {isConnected ? "wallet connected" : "connect a wallet to send transactions"}
          </span>
        </span>
      </div>
      {runtimeErrors.length > 0 && (
        <div className="max-h-24 shrink-0 overflow-y-auto border-b border-danger/40 bg-danger/10 px-3 py-1.5 font-mono text-[10px] text-danger">
          {runtimeErrors.slice(0, 3).map((e, i) => (
            <div key={i} className="break-words">
              {e.message}
              {e.source ? ` (${e.source}:${e.line ?? "?"})` : ""}
            </div>
          ))}
        </div>
      )}
      {error ? (
        <div className="p-4 font-mono text-xs text-danger">{error}</div>
      ) : (
        <iframe
          ref={frameRef}
          srcDoc={bundle?.srcdoc}
          title="Generated app preview"
          // Deliberately no allow-same-origin: the preview runs on an opaque
          // origin and cannot read DevStation's DOM or localStorage (which
          // holds AI provider keys). Wallet access is mediated entirely by the
          // bridge above, which is why it does not need same-origin.
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          className="h-full w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
