import { Check, LoaderCircle } from "lucide-react";
import type { PhaseState } from "@/lib/coding-agent/steps";
import { cn } from "@/lib/utils";

// What the preview shows while the app is being made and there is nothing to
// show yet: the outline of an app taking shape, the stages of the build with
// the one under way marked, and what the agent is doing right now. In place
// of a spinner and a sentence.

export function BuildStage({
  title,
  detail,
  phases,
  elapsed,
}: {
  title: string;
  /** What the agent is doing now, in a few words. */
  detail?: string;
  phases: { label: string; state: PhaseState }[];
  /** "1m 12s" so far, when known. */
  elapsed?: string;
}) {
  const done = phases.filter((p) => p.state === "done").length;
  const progress = Math.round(((done + 0.5) / phases.length) * 100);
  return (
    <div className="w-full max-w-[440px]" role="status" aria-live="polite">
      {/* An app taking shape */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-xl shadow-black/20">
        <div className="flex items-center gap-1.5 border-b border-border bg-surface-2/60 px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-[#ff5f57]/80" />
          <span className="h-2 w-2 rounded-full bg-[#febc2e]/80" />
          <span className="h-2 w-2 rounded-full bg-[#28c840]/80" />
          <span className="ds-skeleton ml-3 h-3.5 flex-1 rounded-md" />
        </div>
        <div className="space-y-3 p-4" aria-hidden>
          <div className="flex items-center justify-between">
            <span className="ds-skeleton h-4 w-20 rounded-md" />
            <span className="flex gap-2">
              <span className="ds-skeleton h-3 w-10 rounded" />
              <span className="ds-skeleton h-3 w-10 rounded" />
              <span className="ds-skeleton h-3 w-12 rounded" />
            </span>
          </div>
          <div className="space-y-2 pt-3">
            <span className="ds-skeleton block h-5 w-3/4 rounded-md" />
            <span className="ds-skeleton block h-5 w-1/2 rounded-md" />
            <span className="ds-skeleton block h-3 w-2/3 rounded" />
          </div>
          <span className="ds-skeleton block h-7 w-28 rounded-lg" />
          <div className="grid grid-cols-3 gap-2 pt-2">
            {[0, 1, 2].map((i) => (
              <span key={i} className="ds-skeleton block h-14 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="h-1 bg-surface-2">
          <div
            className="h-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Where it has got to */}
      <div className="mt-5 px-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[14.5px] font-semibold text-foreground">Building {title}</p>
          {elapsed && (
            <span className="shrink-0 text-[12px] tabular-nums text-meta">{elapsed}</span>
          )}
        </div>
        {detail && (
          <p className="ds-shimmer mt-0.5 truncate text-[13px] text-muted-foreground">{detail}</p>
        )}
        <ol className="mt-4 space-y-2.5">
          {phases.map((p) => (
            <li key={p.label} className="flex items-center gap-2.5 text-[13px]">
              <span
                className={cn(
                  "grid h-5 w-5 shrink-0 place-items-center rounded-full border",
                  p.state === "done" && "border-success/40 bg-success/15 text-success",
                  p.state === "active" && "border-primary/50 bg-primary/10 text-primary",
                  p.state === "pending" && "border-border text-meta",
                )}
              >
                {p.state === "done" ? (
                  <Check className="h-3 w-3" />
                ) : p.state === "active" ? (
                  <LoaderCircle className="h-3 w-3 animate-spin" />
                ) : null}
              </span>
              <span
                className={cn(
                  p.state === "pending" ? "text-meta" : "text-foreground",
                  p.state === "active" && "font-medium",
                )}
              >
                {p.label}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
