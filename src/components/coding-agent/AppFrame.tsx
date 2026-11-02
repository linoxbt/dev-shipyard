import { useEffect, useMemo, useRef, useState } from "react";
import { buildPreview, PREVIEW_ERROR_TAG, type PreviewError } from "@/lib/appgen/preview";

// The app being built, running in a sandboxed frame (no allow-same-origin, so
// it cannot reach DevStation's page, storage or session). Errors the app
// reports come back through onError so the agent can be asked to fix them.
//
// No wallet is wired in: DevStation connects none. An app that needs one is
// opened in its own tab ("Open in new tab"), where a browser wallet works.
//
// Each build mounts a fresh frame (keyed by the bundle): changing srcDoc on a
// live frame adds a browser history entry, which broke the Back button after
// every preview update.

let frames = 0;

export function AppFrame({
  files,
  dir = "",
  assets,
  onError,
  className,
}: {
  files: Record<string, string>;
  dir?: string;
  assets?: Record<string, string>;
  onError?: (error: PreviewError) => void;
  className?: string;
}) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bundle = useMemo(() => {
    try {
      setError(null);
      return { ...buildPreview(files, dir, assets), key: ++frames };
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the preview.");
      return null;
    }
  }, [files, dir, assets]);
  useEffect(() => () => bundle?.revoke(), [bundle]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data as { tag?: string; error?: PreviewError } | undefined;
      if (!msg || msg.tag !== PREVIEW_ERROR_TAG || !msg.error) return;
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;
      onError?.(msg.error);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onError]);

  return (
    <div className={className}>
      {error ? (
        <div className="p-4 font-mono text-xs text-danger">{error}</div>
      ) : (
        <iframe
          key={bundle?.key}
          ref={frameRef}
          srcDoc={bundle?.srcdoc}
          title="App preview"
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
          className="h-full w-full border-0 bg-white"
        />
      )}
    </div>
  );
}
