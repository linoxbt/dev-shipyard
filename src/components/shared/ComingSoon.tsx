import type { ComponentType, ReactNode } from "react";

// Centered "coming soon" placeholder for features that aren't built yet.
export function ComingSoon({
  icon: Icon,
  title,
  note,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  note: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded border border-border bg-surface px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-7 w-7" />
      </div>
      <h2 className="font-mono text-lg font-bold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md font-mono text-xs leading-relaxed text-muted-foreground">
        {note}
      </p>
      {children && <div className="mt-4">{children}</div>}
      <span className="mt-6 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-warning">
        Coming soon
      </span>
    </div>
  );
}
