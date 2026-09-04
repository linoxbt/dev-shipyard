import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { comingSoon } from "@/lib/coming-soon";

// The placeholder shown in place of a page that is not ready.
//
// Built on PageHeader so it sits inside the app rather than beside it: same
// breadcrumb, same back button, same type. A placeholder that looks like a
// different product reads as a broken page, not a planned one.
//
// It says what the page WILL do and offers somewhere that works now. "Coming
// soon" on its own tells you nothing you could act on.
export function ComingSoon({ path }: { path: string }) {
  const page = comingSoon(path);
  // Only rendered for a path that is in the map; if that ever stops being true,
  // say so plainly rather than rendering an empty frame.
  if (!page) return null;
  const Icon = page.icon;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={page.label} subtitle="Not ready yet." />
      <div className="flex flex-1 items-start justify-center p-6 sm:p-10">
        <div className="w-full max-w-md space-y-5 text-center">
          <div className="flex justify-center">
            <span className="rounded-lg border border-border bg-surface-2 p-3 text-primary">
              <Icon className="h-6 w-6" />
            </span>
          </div>

          <div className="space-y-2">
            <p className="font-mono text-[11px] uppercase tracking-wider text-meta">Coming soon</p>
            <p className="text-sm leading-relaxed text-muted-foreground">{page.statement}</p>
          </div>

          <div className="border-t border-border pt-4">
            <Link
              to={page.instead.to}
              className="inline-flex items-center gap-1.5 font-mono text-[11px] text-primary hover:underline"
            >
              {page.instead.label}
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
