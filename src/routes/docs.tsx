import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Github, Menu, Moon, Search, Sun, X, CornerDownLeft } from "lucide-react";
import { DOC_NAV, DOC_ORDER, normaliseDocPath, type DocLink } from "@/components/docs/nav";
import { LogoMark } from "@/components/shared/Logo";
import { useTheme } from "@/lib/theme";
import { consoleHref, siteHref } from "@/lib/site-hosts";

// The documentation site. In production it is docs.devstation.online, with its
// own header, navigation and search, and no console chrome around it.

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "DevStation Docs" },
      {
        name: "description",
        content:
          "Documentation for DevStation: the console, LaunchKit, the Marketplace, the Coding Agent, Routebook, the explorer and the DevStation CLI.",
      },
    ],
  }),
  component: DocsLayout,
  notFoundComponent: DocsNotFound,
});

function DocsLayout() {
  const path = normaliseDocPath(useRouterState({ select: (r) => r.location.pathname }));
  const [navOpen, setNavOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
    setSearchOpen(false);
  }, [path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        (e.target.tagName === "INPUT" ||
          e.target.tagName === "TEXTAREA" ||
          e.target.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DocsHeader onMenu={() => setNavOpen(true)} onSearch={() => setSearchOpen(true)} />

      <div className="mx-auto flex w-full max-w-[1440px] px-4 sm:px-6 lg:px-8">
        <aside className="hidden w-64 shrink-0 lg:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto py-8 pr-6">
            <DocNavList path={path} />
          </div>
        </aside>

        <main className="min-w-0 flex-1 py-10 lg:border-l lg:border-border lg:pl-10 xl:pr-10">
          <div className="mx-auto max-w-3xl pb-16">
            <Outlet />
          </div>
          <DocsFooter />
        </main>

        <aside className="hidden w-56 shrink-0 xl:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto py-10">
            <OnThisPage path={path} />
          </div>
        </aside>
      </div>

      {navOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div className="flex w-80 max-w-[85%] flex-col overflow-y-auto border-r border-border bg-background p-5">
            <div className="mb-6 flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <LogoMark className="h-6 w-6" /> Documentation
              </span>
              <button
                onClick={() => setNavOpen(false)}
                className="rounded p-1 text-meta hover:text-foreground"
                aria-label="Close documentation menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <DocNavList path={path} />
          </div>
          <button
            className="flex-1 bg-background/70 backdrop-blur-sm"
            onClick={() => setNavOpen(false)}
            aria-label="Close menu overlay"
          />
        </div>
      )}

      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function DocsHeader({ onMenu, onSearch }: { onMenu: () => void; onSearch: () => void }) {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-full w-full max-w-[1440px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          onClick={onMenu}
          className="rounded p-1.5 text-muted-foreground hover:text-foreground lg:hidden"
          aria-label="Open documentation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Link to="/docs" className="flex items-center gap-2" aria-label="DevStation Docs">
          <LogoMark className="h-7 w-7" />
          <span className="font-mono text-sm font-bold tracking-tight">
            Dev<span className="text-primary">Station</span>
          </span>
          <span className="rounded border border-border px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-meta">
            Docs
          </span>
        </Link>

        <button
          onClick={onSearch}
          className="ml-auto flex h-9 w-full max-w-xs items-center gap-2 rounded-md border border-border bg-surface px-3 text-left text-sm text-meta transition hover:border-primary/50 md:ml-8 md:mr-auto"
          aria-label="Search documentation"
        >
          <Search className="h-4 w-4" />
          <span className="hidden flex-1 sm:inline">Search docs…</span>
          <kbd className="hidden rounded border border-border bg-background px-1.5 font-mono text-[10px] sm:inline">
            ⌘K
          </kbd>
        </button>

        <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
          <a href={siteHref()} className="hover:text-foreground">
            Home
          </a>
          <Link to="/docs/cli" className="hover:text-foreground">
            CLI
          </Link>
          <a
            href="https://github.com/linoxbt/dev-shipyard"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
        </nav>
        <button
          onClick={toggle}
          className="rounded-md border border-border p-2 text-muted-foreground hover:border-primary hover:text-primary"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <a
          href={consoleHref()}
          className="hidden items-center gap-1 rounded-md bg-primary px-3 py-2 font-mono text-xs font-semibold text-primary-foreground hover:bg-primary-hover sm:inline-flex"
        >
          Open Console <ArrowUpRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </header>
  );
}

function DocNavList({ path }: { path: string }) {
  return (
    <nav className="space-y-7">
      {DOC_NAV.map((group) => (
        <div key={group.group}>
          <div className="mb-2 px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
            {group.group}
          </div>
          <div className="space-y-px">
            {group.items.map((item) => {
              const active = path === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={
                    "block rounded-md px-3 py-1.5 text-[13.5px] transition " +
                    (active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

interface Heading {
  id: string;
  text: string;
  level: 2 | 3;
}

/** The outline of the current page, read from its rendered headings. */
function OnThisPage({ path }: { path: string }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const root = document.querySelector("[data-doc-content]");
    if (!root) {
      setHeadings([]);
      return;
    }
    const nodes = Array.from(root.querySelectorAll<HTMLElement>("h2[id], h3[id]"));
    setHeadings(
      nodes.map((n) => ({
        id: n.id,
        text: n.textContent ?? "",
        level: n.tagName === "H2" ? 2 : 3,
      })),
    );
    if (nodes.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [path]);

  if (headings.length === 0) return null;
  return (
    <div>
      <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground">
        On this page
      </p>
      <ul className="space-y-2 border-l border-border">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={
                "-ml-px block border-l py-0.5 text-[13px] leading-5 transition " +
                (h.level === 3 ? "pl-6 " : "pl-3 ") +
                (active === h.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const withGroup = DOC_NAV.flatMap((g) => g.items.map((item) => ({ ...item, group: g.group })));
    if (!q) return withGroup;
    const words = q.split(/\s+/);
    return withGroup
      .map((item) => {
        const hay = `${item.label} ${item.description} ${item.group}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const score = item.label.toLowerCase().includes(q) ? 0 : 1;
        return { item, score };
      })
      .filter((r): r is { item: DocLink & { group: string }; score: number } => r !== null)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.item);
  }, [query]);

  useEffect(() => setCursor(0), [query]);

  const go = (to: string) => {
    onClose();
    void navigate({ to });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-background/70 px-4 pt-[12vh] backdrop-blur-sm">
      <button className="absolute inset-0" onClick={onClose} aria-label="Close search" />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-meta" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === "Enter" && results[cursor]) go(results[cursor].to);
            }}
            placeholder={`Search ${DOC_ORDER.length} pages…`}
            className="h-12 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-meta"
          />
          <kbd className="rounded border border-border px-1.5 font-mono text-[10px] text-meta">
            esc
          </kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-meta">No pages match “{query}”.</li>
          )}
          {results.map((r, i) => (
            <li key={r.to}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r.to)}
                className={
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left " +
                  (i === cursor ? "bg-primary/10" : "")
                }
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={
                        "text-sm font-medium " + (i === cursor ? "text-primary" : "text-foreground")
                      }
                    >
                      {r.label}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-meta">
                      {r.group}
                    </span>
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{r.description}</p>
                </div>
                {i === cursor && <CornerDownLeft className="h-3.5 w-3.5 text-meta" />}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DocsFooter() {
  return (
    <footer className="mx-auto mt-8 flex max-w-3xl flex-col gap-3 border-t border-border pt-6 text-xs text-meta sm:flex-row sm:items-center">
      <span className="flex items-center gap-2">
        <LogoMark className="h-5 w-5" /> DevStation
      </span>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 sm:ml-auto">
        <a href={siteHref()} className="hover:text-foreground">
          devstation.online
        </a>
        <a href={consoleHref()} className="hover:text-foreground">
          Console
        </a>
        <Link to="/docs/cli/install" className="hover:text-foreground">
          Install the CLI
        </Link>
        <a
          href="https://github.com/linoxbt/dev-shipyard"
          target="_blank"
          rel="noreferrer"
          className="hover:text-foreground"
        >
          GitHub
        </a>
      </nav>
    </footer>
  );
}

function DocsNotFound() {
  return (
    <div className="py-16">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-primary">404</p>
      <h1 className="mt-3 text-3xl font-bold tracking-tight text-foreground">
        This page is not in the docs
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">
        It may have moved. Search the docs, start from the introduction, or open the console if you
        were looking for a tool rather than its documentation.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          to="/docs"
          className="rounded-md bg-primary px-4 py-2 font-mono text-xs font-semibold text-primary-foreground hover:bg-primary-hover"
        >
          Docs home
        </Link>
        <a
          href={consoleHref()}
          className="rounded-md border border-border px-4 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
        >
          Open the console
        </a>
      </div>
    </div>
  );
}
