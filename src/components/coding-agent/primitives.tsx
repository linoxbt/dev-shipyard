import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronRight, X } from "lucide-react";
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
  up,
}: {
  /** Open above the button, for a menu at the foot of the screen. */
  up?: boolean;
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
            "absolute z-50 min-w-[13rem] overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-xl shadow-black/30",
            up ? "bottom-full mb-2" : "top-full mt-1.5",
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

/** A dialog that is a bottom sheet on a phone (grab handle, rounded top, the
 *  way Muse and Base44 present settings and invites) and a centred card on a
 *  larger screen. Closes on Escape and on a tap outside. */
export function Modal({
  title,
  icon: Icon,
  onClose,
  children,
  wide,
  hero,
}: {
  title?: ReactNode;
  icon?: Icon;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Artwork above the title, as on an invite sheet. */
  hero?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 backdrop-blur-[2px] sm:items-start sm:overflow-y-auto sm:p-4 sm:pt-[10vh]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "ds-sheet max-h-[88dvh] w-full overflow-y-auto rounded-t-[28px] border border-b-0 border-border bg-surface shadow-2xl shadow-black/50 sm:max-h-none sm:rounded-3xl sm:border-b",
          wide ? "sm:max-w-xl" : "sm:max-w-md",
        )}
      >
        <div className="flex justify-center pb-1 pt-3 sm:hidden">
          <span className="h-1.5 w-12 rounded-full bg-border" />
        </div>
        {hero}
        {title && (
          <div className="flex items-center gap-2.5 px-5 pb-1 pt-3 sm:pt-5">
            {Icon && <Icon className="h-4 w-4 text-primary" />}
            <p className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
              {title}
            </p>
            <button
              onClick={onClose}
              className="hidden rounded-full p-1.5 text-meta hover:bg-surface-2 hover:text-foreground sm:block"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3">{children}</div>
      </div>
    </div>
  );
}

/** A row in a settings-style list: icon, label, optional detail, chevron. */
export function SheetRow({
  icon: Icon,
  children,
  detail,
  onClick,
  href,
  disabled,
  danger,
  chevron = true,
}: {
  icon: Icon;
  children: ReactNode;
  detail?: ReactNode;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  danger?: boolean;
  chevron?: boolean;
}) {
  const body = (
    <>
      <Icon className={cn("h-5 w-5 shrink-0", danger ? "text-danger" : "text-foreground/80")} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-[15px]",
          danger ? "text-danger" : "text-foreground",
        )}
      >
        {children}
      </span>
      {detail && <span className="shrink-0 text-[12.5px] text-meta">{detail}</span>}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-meta" />}
    </>
  );
  const cls =
    "flex w-full items-center gap-4 rounded-xl px-2 py-3 text-left transition hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40";
  if (href) {
    return (
      <a href={href} className={cls}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls}>
      {body}
    </button>
  );
}

/** A panel that slides in from the left over the page. */
export function Drawer({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[55] bg-black/55 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <aside className="ds-drawer flex h-full w-[min(20rem,86vw)] flex-col border-r border-border bg-surface shadow-2xl shadow-black/50">
        {children}
      </aside>
    </div>
  );
}

/** A round icon button, as in the headers of both apps. */
export function RoundButton({
  onClick,
  label,
  icon: Icon,
  dot,
  className,
}: {
  onClick: () => void;
  label: string;
  icon: Icon;
  dot?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-foreground/85 transition hover:bg-border/70 hover:text-foreground",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
      {dot && (
        <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary ring-2 ring-surface-2" />
      )}
    </button>
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
