import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, Network, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// The message box: one rounded card with the text area on top and a toolbar
// underneath (what to start from, which network, send or stop), the way
// Lovable, Base44 and Claude Code all lay it out. It grows with what you type.

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  sending,
  canSend = true,
  placeholder,
  variant = "dock",
  tools,
  network,
  notice,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running?: boolean;
  sending?: boolean;
  canSend?: boolean;
  placeholder: string;
  variant?: "hero" | "dock";
  /** Left side of the toolbar. */
  tools?: ReactNode;
  network?: string;
  notice?: ReactNode;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const hero = variant === "hero";

  // Grow to fit, up to a limit, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, hero ? 280 : 220)}px`;
  }, [value, hero]);

  const disabled = !value.trim() || !!sending || !canSend;
  return (
    <div
      className={cn(
        "rounded-2xl border border-border bg-surface transition focus-within:border-primary/60",
        hero ? "shadow-2xl shadow-black/30" : "shadow-lg shadow-black/20",
      )}
    >
      {notice && <div className="border-b border-border px-3.5 py-1.5">{notice}</div>}
      <textarea
        ref={ref}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!disabled && !running) onSend();
          }
        }}
        rows={hero ? 3 : 2}
        placeholder={placeholder}
        className={cn(
          "block w-full resize-none bg-transparent px-3.5 pt-3 text-foreground placeholder:text-meta focus:outline-none",
          hero ? "min-h-[5.5rem] text-[15px] leading-6" : "min-h-[3.25rem] text-[13.5px] leading-6",
        )}
      />
      <div className="flex items-center gap-1.5 px-2 pb-2 pt-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{tools}</div>
        {network && (
          <span
            className="hidden items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10px] text-meta sm:inline-flex"
            title="The network the agent uses when the work involves one"
          >
            <Network className="h-3 w-3" /> {network}
          </span>
        )}
        {running ? (
          <button
            onClick={onStop}
            title="Stop"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-80"
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={disabled}
            title="Send (Enter)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-surface-2 disabled:text-meta"
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/** A small pill in the composer's toolbar. */
export function ToolChip({
  active,
  onClick,
  icon: Icon,
  children,
  title,
  as = "button",
}: {
  active?: boolean;
  onClick?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: ReactNode;
  title?: string;
  as?: "button" | "span";
}) {
  const Tag = as;
  return (
    <Tag
      {...(as === "button" ? { type: "button" as const, onClick } : {})}
      title={title}
      className={cn(
        "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] transition",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Tag>
  );
}
