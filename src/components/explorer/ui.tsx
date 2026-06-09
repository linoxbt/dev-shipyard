import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Check, CheckCircle2, XCircle, FileCode2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortHash, shortAddr } from "@/lib/explorer/format";
import { useExplorerNetwork } from "@/lib/explorer/network";

/* ── Links to explorer detail pages (network-scoped to the URL) ── */

export function TxLink({
  hash,
  short = true,
  className,
}: {
  hash: string;
  short?: boolean;
  className?: string;
}) {
  const network = useExplorerNetwork();
  return (
    <Link
      to="/explorer/$network/tx/$hash"
      params={{ network, hash }}
      className={cn("font-mono text-info hover:underline", className)}
    >
      {short ? shortHash(hash) : hash}
    </Link>
  );
}

export function AddrLink({
  hash,
  name,
  short = true,
  isContract,
  className,
}: {
  hash: string;
  name?: string | null;
  short?: boolean;
  isContract?: boolean;
  className?: string;
}) {
  const network = useExplorerNetwork();
  return (
    <Link
      to="/explorer/$network/address/$hash"
      params={{ network, hash }}
      className={cn(
        "inline-flex items-center gap-1 font-mono text-info hover:underline",
        className,
      )}
    >
      {isContract && <FileCode2 className="h-3 w-3 text-meta" />}
      {name || (short ? shortAddr(hash) : hash)}
    </Link>
  );
}

export function BlockLink({ height, className }: { height: number | string; className?: string }) {
  const network = useExplorerNetwork();
  return (
    <Link
      to="/explorer/$network/block/$height"
      params={{ network, height: String(height) }}
      className={cn("font-mono text-info hover:underline", className)}
    >
      {Number(height).toLocaleString()}
    </Link>
  );
}

export function TokenLink({
  hash,
  label,
  className,
}: {
  hash: string;
  label?: string;
  className?: string;
}) {
  const network = useExplorerNetwork();
  return (
    <Link
      to="/explorer/$network/token/$hash"
      params={{ network, hash }}
      className={cn("font-mono text-info hover:underline", className)}
    >
      {label || shortAddr(hash)}
    </Link>
  );
}

/* ── Copy-to-clipboard ── */

export function CopyBtn({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className={cn("text-meta transition hover:text-foreground", className)}
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

/* ── Status pill ── */

export function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
        ok
          ? "border-success/40 bg-success/10 text-success"
          : "border-danger/40 bg-danger/10 text-danger",
      )}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {ok ? "Success" : "Failed"}
    </span>
  );
}

export function MethodPill({ method }: { method?: string | null }) {
  if (!method) return <span className="text-meta">—</span>;
  return (
    <span className="inline-block max-w-[140px] truncate rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {method}
    </span>
  );
}

/* ── Cards, sections, detail rows ── */

export function Card({
  title,
  action,
  children,
  className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("overflow-hidden rounded border border-border bg-surface", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {title}
          </h2>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

// A label/value row, Etherscan's overview-row style.
export function Row({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-border px-4 py-3 last:border-0 sm:flex-row sm:gap-4">
      <div className="w-full shrink-0 font-mono text-xs text-meta sm:w-64" title={hint}>
        {label}
      </div>
      <div className="min-w-0 flex-1 break-words font-mono text-xs text-foreground">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="mt-1 font-mono text-lg font-bold text-foreground">{value}</div>
      {sub != null && (
        <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{sub}</div>
      )}
    </div>
  );
}

/* ── Tabs ── */

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string; count?: number | string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "border-b-2 px-3 py-2 font-mono text-xs transition",
            active === t.id
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {t.label}
          {t.count != null && <span className="ml-1 text-[10px] text-meta">({t.count})</span>}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-10 text-center font-mono text-xs text-meta">{children}</div>;
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-10 font-mono text-xs text-meta">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-primary" />
      {label}…
    </div>
  );
}
