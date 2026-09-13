import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, ArrowRight, Info, Lightbulb, Link2 } from "lucide-react";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { consoleHref } from "@/lib/site-hosts";
import { docGroupOf, docNeighbors } from "./nav";

// Shared building blocks for the docs pages, so every page has the same
// typography, spacing and structure. DocPage adds the breadcrumb and the
// prev/next links itself, from nav.ts, so a page cannot fall out of order.

export function DocPage({
  title,
  intro,
  icon: Icon,
  children,
}: {
  title: string;
  intro?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const group = docGroupOf(path);
  const { prev, next } = docNeighbors(path);
  return (
    <article className="min-w-0">
      {group && (
        <p className="mb-3 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-primary">
          {group}
        </p>
      )}
      <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        {Icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface">
            <Icon className="h-5 w-5 text-primary" />
          </span>
        )}
        {title}
      </h1>
      {intro && (
        <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground sm:text-[17px]">
          {intro}
        </p>
      )}
      <div className="mt-10 space-y-5" data-doc-content>
        {children}
      </div>
      <PageNav prev={prev} next={next} />
    </article>
  );
}

export function slugify(node: React.ReactNode): string {
  const text = nodeText(node);
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function nodeText(node: React.ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

export function H2({ children, id }: { children: React.ReactNode; id?: string }) {
  const anchor = id ?? slugify(children);
  return (
    <h2
      id={anchor}
      className="group scroll-mt-24 border-t border-border pt-10 text-2xl font-semibold tracking-tight text-foreground first:border-0 first:pt-0"
    >
      <a href={`#${anchor}`} className="inline-flex items-center gap-2">
        {children}
        <Link2 className="h-4 w-4 text-meta opacity-0 transition group-hover:opacity-100" />
      </a>
    </h2>
  );
}

export function H3({ children, id }: { children: React.ReactNode; id?: string }) {
  const anchor = id ?? slugify(children);
  return (
    <h3
      id={anchor}
      className="scroll-mt-24 pt-3 text-lg font-semibold tracking-tight text-foreground"
    >
      {children}
    </h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[15px] leading-7 text-muted-foreground">{children}</p>;
}

/** Inline code. */
export function C({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">
      {children}
    </code>
  );
}

/** A command or snippet, with a copy button. */
export function Code({ code, language = "bash" }: { code: string; language?: string }) {
  return (
    <CodeBlock code={code.replace(/^\n+|\s+$/g, "")} language={language} showLineNumbers={false} />
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-[15px] leading-7 text-muted-foreground">
          <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ul>
  );
}

export function Steps({ steps }: { steps: { title: string; body: React.ReactNode }[] }) {
  return (
    <ol className="relative space-y-6 border-l border-border pl-8">
      {steps.map((s, i) => (
        <li key={i} className="relative">
          <span className="absolute -left-[45px] flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background font-mono text-xs font-bold text-primary">
            {i + 1}
          </span>
          <div className="text-[15px] font-semibold text-foreground">{s.title}</div>
          <div className="mt-1 space-y-3 text-[15px] leading-7 text-muted-foreground">{s.body}</div>
        </li>
      ))}
    </ol>
  );
}

export function CardGrid({ children, cols = 2 }: { children: React.ReactNode; cols?: 2 | 3 }) {
  return (
    <div className={`grid gap-3 sm:grid-cols-2 ${cols === 3 ? "lg:grid-cols-3" : ""}`}>
      {children}
    </div>
  );
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
  const inner = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-background">
          <Icon className="h-4 w-4 text-primary" />
        </span>
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <ArrowRight className="ml-auto h-4 w-4 text-meta transition group-hover:translate-x-0.5 group-hover:text-primary" />
      </div>
      <p className="mt-3 text-[13px] leading-6 text-muted-foreground">{body}</p>
    </>
  );
  const cls =
    "group block rounded-lg border border-border bg-surface p-4 transition hover:border-primary/50 hover:bg-surface-2";
  // Console pages live on another hostname in production; a plain link gets
  // there, where a router link would try to find them inside the docs site.
  if (!to.startsWith("/docs")) {
    return (
      <a href={consoleHref(to)} className={cls}>
        {inner}
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  );
}

/** A link to a docs page. */
export function DocLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link to={to} className="font-medium text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

/** A link into the console, which is another hostname in production. */
export function ConsoleLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <a
      href={consoleHref(to)}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

export function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

const CALLOUT = {
  info: { icon: Info, cls: "border-info/30 bg-info/5", iconCls: "text-info", label: "Note" },
  tip: {
    icon: Lightbulb,
    cls: "border-success/30 bg-success/5",
    iconCls: "text-success",
    label: "Tip",
  },
  warning: {
    icon: AlertTriangle,
    cls: "border-warning/40 bg-warning/5",
    iconCls: "text-warning",
    label: "Important",
  },
} as const;

export function Callout({
  children,
  tone = "info",
  title,
}: {
  children: React.ReactNode;
  tone?: keyof typeof CALLOUT;
  title?: string;
}) {
  const c = CALLOUT[tone];
  const Icon = c.icon;
  return (
    <div className={`flex gap-3 rounded-lg border ${c.cls} p-4`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.iconCls}`} />
      <div className="min-w-0 text-[14px] leading-6 text-muted-foreground">
        <p className="mb-0.5 font-semibold text-foreground">{title ?? c.label}</p>
        <div className="space-y-2">{children}</div>
      </div>
    </div>
  );
}

export function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-2">
          <tr>
            {head.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] font-medium uppercase tracking-wider text-meta"
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
                    "px-4 py-2.5 align-top leading-6 " +
                    (j === 0
                      ? "whitespace-nowrap font-mono text-[13px] text-foreground"
                      : "text-[13px] text-muted-foreground")
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

export function FaqItem({ q, a }: { q: string; a: React.ReactNode }) {
  return (
    <details className="group rounded-lg border border-border bg-surface px-4 py-3 open:bg-surface-2">
      <summary className="cursor-pointer list-none text-[15px] font-semibold text-foreground marker:hidden">
        <span className="flex items-center justify-between gap-4">
          {q}
          <ArrowRight className="h-4 w-4 shrink-0 text-meta transition group-open:rotate-90" />
        </span>
      </summary>
      <div className="mt-2 text-[14px] leading-6 text-muted-foreground">{a}</div>
    </details>
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
  if (!prev && !next) return null;
  return (
    <nav className="mt-16 grid gap-3 border-t border-border pt-8 sm:grid-cols-2">
      {prev ? (
        <Link
          to={prev.to}
          className="group rounded-lg border border-border p-4 transition hover:border-primary/50"
        >
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-meta">
            <ArrowLeft className="h-3 w-3" /> Previous
          </span>
          <span className="mt-1 block text-sm font-semibold text-foreground group-hover:text-primary">
            {prev.label}
          </span>
        </Link>
      ) : (
        <span className="hidden sm:block" />
      )}
      {next && (
        <Link
          to={next.to}
          className="group rounded-lg border border-border p-4 text-right transition hover:border-primary/50"
        >
          <span className="flex items-center justify-end gap-1.5 font-mono text-[11px] uppercase tracking-wider text-meta">
            Next <ArrowRight className="h-3 w-3" />
          </span>
          <span className="mt-1 block text-sm font-semibold text-foreground group-hover:text-primary">
            {next.label}
          </span>
        </Link>
      )}
    </nav>
  );
}
