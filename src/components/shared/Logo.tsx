import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import logoMark from "@/assets/logo-mark.png";

// DevStation brand mark: the hexagonal ribbon "D" on a black rounded tile.
// A raster of the supplied artwork (src/assets/logo-mark.png, 192px, rounded
// corners already transparent), shown at most 64px wide, so it stays sharp.
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src={logoMark}
      alt="DevStation"
      width={28}
      height={28}
      draggable={false}
      className={cn("h-7 w-7 shrink-0 select-none", className)}
    />
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  // Clickable brand: navigates back to the landing page.
  return (
    <Link to="/" className="flex items-center gap-2" aria-label="DevStation home">
      <LogoMark />
      {!compact && (
        <div>
          <div className="font-mono text-sm font-bold tracking-tight text-foreground">
            Dev<span className="text-primary">Station</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
            AI Developer OS
          </div>
        </div>
      )}
    </Link>
  );
}
