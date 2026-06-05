import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Search, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TEMPLATES, CATEGORIES, categoryColor, type TemplateCategory } from "@/lib/mock/templates";

export const Route = createFileRoute("/launchkit/templates")({
  head: () => ({
    meta: [
      { title: "Templates — DevStation LaunchKit" },
      { name: "description", content: "Verified Solidity contract templates ready to deploy on QIE Testnet." },
    ],
  }),
  component: TemplateGallery,
});

type CatFilter = "All" | TemplateCategory;

function TemplateGallery() {
  const [cat, setCat] = useState<CatFilter>("All");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"deploys" | "newest" | "alpha">("deploys");

  const filtered = useMemo(() => {
    let list = [...TEMPLATES];
    if (cat !== "All") list = list.filter((t) => t.category === cat);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(
        (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
      );
    }
    if (sort === "deploys") list.sort((a, b) => b.deployCount - a.deployCount);
    else if (sort === "alpha") list.sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [cat, query, sort]);

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Templates"]}
        title="Template Gallery"
        subtitle="Verified contracts. Configure and ship in 60 seconds."
        action={
          <button className="rounded border border-border bg-transparent px-3 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary">
            + Submit a Template
          </button>
        }
      />

      <div className="p-6">
        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`rounded border px-2.5 py-1 font-mono text-[11px] transition ${
                cat === c
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-64">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-meta" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates by name or description..."
              className="w-full rounded border border-border bg-background py-1.5 pl-7 pr-3 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "deploys" | "newest" | "alpha")}
            className="rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="deploys">Sort: Most Deployed</option>
            <option value="newest">Sort: Newest</option>
            <option value="alpha">Sort: Alphabetical</option>
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded border border-border bg-surface p-10 text-center font-mono text-xs text-meta">
            No templates found matching your filter.
            <button onClick={() => { setCat("All"); setQuery(""); }} className="ml-2 text-primary hover:underline">
              Reset
            </button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((t) => (
              <article
                key={t.id}
                className="flex flex-col rounded border border-border bg-surface p-4 transition hover:border-primary/40"
              >
                <div className="mb-3 flex items-start justify-between">
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${categoryColor(t.category)}`}>
                    {t.category}
                  </span>
                  {t.verified && (
                    <span className="flex items-center gap-1 font-mono text-[10px] text-success">
                      <CheckCircle2 className="h-3 w-3" />
                      VERIFIED
                    </span>
                  )}
                </div>

                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-mono text-base font-bold text-foreground">{t.name}</h3>
                  <span className="font-mono text-[10px] text-meta">{t.deployCount} deploys</span>
                </div>

                <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{t.description}</p>

                <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-meta">
                  <span>Solidity: ^0.8.20</span>
                  <span>Constructor args: {t.args.length}</span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {t.tags.map((tag) => (
                    <span key={tag} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="mt-4 flex gap-2 border-t border-border pt-3">
                  <Link
                    to="/launchkit/templates/$id"
                    params={{ id: t.id }}
                    className="flex-1 rounded border border-border px-2 py-1.5 text-center font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
                  >
                    View Code
                  </Link>
                  <Link
                    to="/launchkit/deploy"
                    search={{ template: t.id }}
                    className="flex-1 rounded bg-primary px-2 py-1.5 text-center font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
                  >
                    Deploy →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
