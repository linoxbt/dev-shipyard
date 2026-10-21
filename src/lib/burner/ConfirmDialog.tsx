/* eslint-disable react-refresh/only-export-components -- mounted imperatively, never hot-reloaded as a page component */
// The approval dialog for signing requests (see ./confirm.ts).
//
// Mounted on demand into its own root rather than through the app tree, so a
// signing request can be confirmed from anywhere, including code running
// outside React (the wallet connector), and so it cannot be forgotten by a
// page that never rendered a provider for it.

import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { AlertTriangle } from "lucide-react";
import type { SignRequest } from "./confirm";

// One at a time: a second request waits for the first to be answered.
let queue: Promise<unknown> = Promise.resolve();

export function showConfirmDialog(req: SignRequest): Promise<boolean> {
  const next = queue.then(() => open(req));
  queue = next.catch(() => undefined);
  return next;
}

function open(req: SignRequest): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (ok: boolean) => {
      root.unmount();
      host.remove();
      resolve(ok);
    };
    root.render(<Dialog req={req} onAnswer={done} />);
  });
}

function Dialog({ req, onAnswer }: { req: SignRequest; onAnswer: (ok: boolean) => void }) {
  const rejectRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // Focus starts on Reject: Enter should never approve by accident.
    rejectRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onAnswer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAnswer]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ds-sign-title"
        className="w-full max-w-md rounded-lg border border-border bg-surface shadow-xl"
      >
        <div className="border-b border-border px-4 py-3">
          <h2 id="ds-sign-title" className="font-mono text-sm font-bold text-foreground">
            {req.title}
          </h2>
          <p className="mt-0.5 font-mono text-[10px] text-meta">
            {req.source === "preview"
              ? "Requested by the app running in the preview, not by DevStation."
              : "Requested by DevStation for your in-app wallet."}
          </p>
        </div>
        {req.warning && (
          <div className="flex gap-2 border-b border-danger/40 bg-danger/10 px-4 py-2 font-mono text-[11px] text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{req.warning}</span>
          </div>
        )}
        <dl className="max-h-72 space-y-1.5 overflow-y-auto px-4 py-3 font-mono text-[11px]">
          {req.rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[5.5rem_1fr] gap-2">
              <dt className="text-meta">{k}</dt>
              <dd className="break-all text-foreground">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            ref={rejectRef}
            onClick={() => onAnswer(false)}
            className="rounded border border-border px-3 py-1.5 font-mono text-xs text-foreground hover:bg-background"
          >
            Reject
          </button>
          <button
            onClick={() => onAnswer(true)}
            className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
