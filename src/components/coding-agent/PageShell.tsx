import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { LogoMark } from "@/components/shared/Logo";

// A full page of the app (account, connected accounts, updates): the header
// with a way back to where the person came from, and the page in a column.
// Pages, not pop-ups: each has its own address, survives a refresh and can be
// opened in a tab.

/** Where "Back" goes: the page that opened this one (?back=…, a path on this
 *  site only), or the app. */
export function useBackHref(): string {
  const [back, setBack] = useState("/");
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("back") ?? "";
    if (raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\")) setBack(raw);
  }, []);
  return back;
}

/** A link to one of these pages that comes back to the page it was opened from. */
export function pageHref(path: string): string {
  if (typeof window === "undefined") return path;
  const here = `${window.location.pathname}${window.location.search}`;
  return `${path}${path.includes("?") ? "&" : "?"}back=${encodeURIComponent(here)}`;
}

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const back = useBackHref();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <a
            href={back}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13.5px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </a>
          <a href="/" className="ml-auto flex items-center gap-2" aria-label="DevStation">
            <LogoMark className="h-6 w-6" />
            <span className="text-[14px] font-semibold">DevStation</span>
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22.5px] font-semibold tracking-tight">{title}</h1>
            {description && (
              <p className="mt-1 max-w-xl text-[13.5px] leading-5 text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions}
        </div>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
