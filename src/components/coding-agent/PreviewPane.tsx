import { useEffect, useState, type ReactNode } from "react";
import {
  ExternalLink,
  Globe,
  Lock,
  Monitor,
  RotateCw,
  Smartphone,
  Tablet,
  WandSparkles,
} from "lucide-react";
import { PreviewFrame } from "@/components/appbuilder/PreviewFrame";
import type { PreviewError } from "@/lib/appgen/preview";
import { cn } from "@/lib/utils";
import { Segmented } from "./primitives";

// The preview as a small browser: an address bar, reload, and the width it is
// shown at (desktop, tablet, phone), like Lovable's and Base44's. An error the
// running app reports gets a button that hands it to the agent.

export type Device = "desktop" | "tablet" | "mobile";
const WIDTH: Record<Device, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };

export function PreviewPane({
  files,
  dir,
  assets,
  chainName,
  liveUrl,
  status,
  empty,
  onFix,
  actions,
}: {
  files: Record<string, string> | null;
  dir: string;
  assets?: Record<string, string>;
  chainName: string;
  liveUrl?: string | null;
  /** A line above the frame: building, failed, rebuild. */
  status?: ReactNode;
  /** What fills the pane when there is nothing to show yet. */
  empty: ReactNode;
  onFix: (message: string) => void;
  /** Extra buttons at the end of the address bar. */
  actions?: ReactNode;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [reload, setReload] = useState(0);
  const [errors, setErrors] = useState<PreviewError[]>([]);
  // New files, new app: old errors no longer apply.
  useEffect(() => setErrors([]), [files]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center gap-2 border-b border-border bg-surface px-2.5 py-1.5">
        <button
          onClick={() => {
            setErrors([]);
            setReload((n) => n + 1);
          }}
          disabled={!files}
          title="Reload the preview"
          className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-40"
        >
          <RotateCw className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1">
          {liveUrl ? (
            <Lock className="h-3 w-3 shrink-0 text-success" />
          ) : (
            <Globe className="h-3 w-3 shrink-0 text-meta" />
          )}
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
            {liveUrl ? liveUrl.replace(/^https?:\/\//, "") : "preview"}
          </span>
        </div>
        <div className="hidden md:block">
          <Segmented
            size="sm"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "Desktop", icon: Monitor, hideLabel: true },
              { value: "tablet", label: "Tablet", icon: Tablet, hideLabel: true },
              { value: "mobile", label: "Phone", icon: Smartphone, hideLabel: true },
            ]}
          />
        </div>
        {actions}
        {liveUrl && (
          <a
            href={liveUrl}
            target="_blank"
            rel="noreferrer"
            title="Open the live app"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      {status && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1 font-mono text-[9.5px] text-meta">
          {status}
        </div>
      )}

      {errors.length > 0 && (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/10 px-3 py-2">
          <div className="min-w-0 flex-1 font-mono text-[10px] text-danger">
            {errors.slice(0, 2).map((e, i) => (
              <p key={i} className="truncate" title={e.message}>
                {e.message}
                {e.source ? ` (${e.source}:${e.line ?? "?"})` : ""}
              </p>
            ))}
            {errors.length > 2 && <p className="text-danger/70">+{errors.length - 2} more</p>}
          </div>
          <button
            onClick={() =>
              onFix(
                `The preview shows ${errors.length === 1 ? "this error" : "these errors"}. Find the cause and fix it:\n\n${errors
                  .slice(0, 5)
                  .map((e) => `- ${e.message}${e.source ? ` (${e.source}:${e.line ?? "?"})` : ""}`)
                  .join("\n")}`,
              )
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-[11px] font-medium text-white transition hover:opacity-90"
          >
            <WandSparkles className="h-3.5 w-3.5" /> Fix with agent
          </button>
        </div>
      )}

      <div
        className={cn(
          "flex min-h-0 flex-1 justify-center",
          device !== "desktop" && "overflow-auto bg-surface-2/40 p-4",
        )}
      >
        {files ? (
          <div
            className={cn(
              "flex h-full min-h-0 flex-col",
              device !== "desktop" &&
                "max-h-[56rem] overflow-hidden rounded-xl border border-border shadow-xl shadow-black/30",
            )}
            style={{ width: WIDTH[device], maxWidth: "100%" }}
          >
            <PreviewFrame
              key={reload}
              files={files}
              dir={dir}
              assets={assets}
              chainName={chainName}
              bare
              onError={(e) =>
                setErrors((prev) =>
                  prev.some((p) => p.message === e.message) ? prev : [...prev, e],
                )
              }
              className="flex h-full min-h-0 flex-1 flex-col"
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center p-6">{empty}</div>
        )}
      </div>
    </div>
  );
}
