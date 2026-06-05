import { cn } from "@/lib/utils";

export type StatusKind =
  | "DEPLOYED"
  | "PENDING"
  | "VERIFYING"
  | "VERIFIED"
  | "FAILED"
  | "REVERTED"
  | "SUCCESS"
  | "AUTO"
  | "COMMUNITY";

const STYLES: Record<StatusKind, string> = {
  DEPLOYED: "bg-success/15 text-success border-success/30",
  SUCCESS: "bg-success/15 text-success border-success/30",
  VERIFIED: "bg-info/15 text-info border-info/30",
  PENDING: "bg-warning/15 text-warning border-warning/30",
  VERIFYING: "bg-info/15 text-info border-info/30",
  FAILED: "bg-danger/15 text-danger border-danger/30",
  REVERTED: "bg-danger/15 text-danger border-danger/30",
  AUTO: "bg-primary/15 text-primary border-primary/30",
  COMMUNITY: "bg-info/15 text-info border-info/30",
};

export function StatusBadge({ kind, className }: { kind: StatusKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
        STYLES[kind],
        className,
      )}
    >
      {kind}
    </span>
  );
}
