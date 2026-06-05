import { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  action,
  className,
}: {
  breadcrumb?: string[];
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("border-b border-border bg-background px-6 py-5", className)}>
      {breadcrumb && breadcrumb.length > 0 && (
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">
          {breadcrumb.join(" / ")}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-mono text-xl font-bold text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
    </div>
  );
}
