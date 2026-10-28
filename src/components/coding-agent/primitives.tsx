import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// The few interactive pieces the Coding Agent needs and the app has no
// library for: a dropdown that closes on outside click and Escape, and a
// modal. Both trap nothing and render inline, so they need no portal.

type Icon = React.ComponentType<{ className?: string }>;

export function Dropdown({
  trigger,
  triggerClassName,
  children,
  align = "left",
  className,
  label,
}: {
  /** The button's content; the button itself is rendered here. */
  trigger: (open: boolean) => ReactNode;
  triggerClassName?: string;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((v) => !v)}
        className={triggerClassName}
      >
        {trigger(open)}
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute top-full z-50 mt-1.5 min-w-[13rem] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl shadow-black/30",
            align === "right" ? "right-0" : "left-0",
            className,
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  children,
  hint,
  onClick,
  disabled,
  danger,
}: {
  icon?: Icon;
  children: ReactNode;
  hint?: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[13px] transition disabled:pointer-events-none disabled:opacity-40",
        danger ? "text-danger hover:bg-danger/10" : "text-foreground hover:bg-surface-2",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 font-mono text-[10px] text-meta">{hint}</span>}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-2 font-mono text-[10px] uppercase tracking-wider text-meta">
      {children}
    </p>
  );
}

export function Modal({
  title,
  icon: Icon,
  onClose,
  children,
  wide,
}: {
  title: ReactNode;
  icon?: Icon;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "w-full rounded-xl border border-border bg-surface shadow-2xl shadow-black/40",
          wide ? "max-w-xl" : "max-w-md",
        )}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</p>
          <button
            onClick={onClose}
            className="rounded p-1 text-meta hover:bg-surface-2 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

/** A segmented control: Preview / Code / Activity, or device sizes. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: Icon; hideLabel?: boolean; badge?: ReactNode }[];
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-background p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            title={o.label}
            aria-pressed={active}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md transition",
              size === "sm" ? "px-1.5 py-1" : "px-2.5 py-1",
              active
                ? "bg-surface-2 text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            {!o.hideLabel && (
              <span className={cn("text-[12px]", Icon && "hidden sm:inline")}>{o.label}</span>
            )}
            {o.badge}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-meta">
        {label}
      </span>
      {children}
    </label>
  );
}

export const inputClass =
  "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none";

export const primaryButton =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-40";

export const ghostButton =
  "inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground disabled:opacity-40";
