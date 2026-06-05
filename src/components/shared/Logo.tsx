import { cn } from "@/lib/utils";

// DevStation brand mark: a terminal prompt chevron + caret inside a rounded
// square, in the amber primary with a QIE-teal underscore. Pure SVG so it
// scales crisply and inherits theme colors.
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("h-7 w-7", className)}
      role="img"
      aria-label="DevStation"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="6" fill="#e67e22" fillOpacity="0.12" />
      <rect x="1.5" y="1.5" width="29" height="29" rx="6" stroke="#e67e22" strokeWidth="1.5" />
      {/* prompt chevron > */}
      <path
        d="M9 11.5L13.5 16L9 20.5"
        stroke="#e67e22"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* blinking caret underscore in QIE teal */}
      <path d="M16.5 21.5H23" stroke="#1294a9" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <LogoMark />
      {!compact && (
        <div>
          <div className="font-mono text-sm font-bold tracking-tight text-foreground">
            Dev<span className="text-primary">Station</span>
          </div>
          <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
            QIE Builder Console
          </div>
        </div>
      )}
    </div>
  );
}
