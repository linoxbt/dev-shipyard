import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

// Shared building blocks for the docs pages, so every page has the same
// typography, spacing, and terminal aesthetic.

export function DocPage({
  title,
  intro,
  icon: Icon,
  children,
}: {
  title: string;
  intro?: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h1 className="flex items-center gap-2 font-mono text-3xl font-bold tracking-tight text-foreground">
        {Icon && <Icon className="h-6 w-6 text-primary" />}
        {title}
      </h1>
      {intro && <p className="mt-3 max-w-2xl text-base text-muted-foreground">{intro}</p>}
      <div className="mt-8 space-y-5">{children}</div>
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="pt-4 font-mono text-xl font-bold text-foreground first:pt-0">{children}</h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="pt-2 font-mono text-base font-semibold text-foreground">{children}</h3>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>;
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2 text-sm leading-relaxed text-muted-foreground">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Steps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="flex gap-3 rounded border border-border bg-surface p-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-xs font-bold text-primary">
            {i + 1}
          </span>
          <div>
            <div className="font-mono text-sm font-semibold text-foreground">{s.title}</div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function FeatureCard({
  icon: Icon,
  title,
  body,
  to,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  body: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group rounded border border-border bg-surface p-4 transition hover:border-primary/50"
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm font-semibold text-foreground">{title}</span>
        <ArrowRight className="ml-auto h-3.5 w-3.5 text-meta transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
    </Link>
  );
}

export function Callout({
  children,
  tone = "info",
}: {
  children: React.ReactNode;
  tone?: "info" | "warning";
}) {
  const accent = tone === "warning" ? "border-warning/40 bg-warning/5" : "border-info/30 bg-info/5";
  return (
    <div className={`rounded border ${accent} p-3 text-sm leading-relaxed text-muted-foreground`}>
      {children}
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-meta"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-border">
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={
                    "px-3 py-2 align-top " +
                    (j === 0
                      ? "font-mono text-xs text-foreground"
                      : "text-xs text-muted-foreground")
                  }
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="border-b border-border pb-4 last:border-0">
      <p className="font-mono text-sm font-semibold text-foreground">{q}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{a}</p>
    </div>
  );
}

// Prev / next navigation between doc pages.
export function PageNav({
  prev,
  next,
}: {
  prev?: { to: string; label: string };
  next?: { to: string; label: string };
}) {
  return (
    <div className="mt-10 flex items-center justify-between border-t border-border pt-6">
      {prev ? (
        <Link
          to={prev.to}
          className="group inline-flex items-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" />
          {prev.label}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link
          to={next.to}
          className="group inline-flex items-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          {next.label}
          <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
