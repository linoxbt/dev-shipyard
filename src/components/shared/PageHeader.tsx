import { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

export function PageHeader({
  breadcrumb,
  title,
  subtitle,
  action,
  className,
  showBack = true,
}: {
  breadcrumb?: string[];
  title: string;
  subtitle?: string;
  action?: ReactNode;
  className?: string;
  /** Back button shows by default on every page except the home route. */
  showBack?: boolean;
}) {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const canShowBack = showBack && pathname !== "/";

  const goBack = () => {
    // Prefer real history; fall back to the overview if there's nowhere to go.
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.history.back();
    } else {
      router.navigate({ to: "/" });
    }
  };

  return (
    <div className={cn("border-b border-border bg-background px-6 py-5", className)}>
      <div className="mb-2 flex items-center gap-3">
        {canShowBack && (
          <button
            onClick={goBack}
            className="flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition hover:border-primary hover:text-primary"
            aria-label="Go back"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        )}
        {breadcrumb && breadcrumb.length > 0 && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
            {breadcrumb.join(" / ")}
          </div>
        )}
      </div>
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
