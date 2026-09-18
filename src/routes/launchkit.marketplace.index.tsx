import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ArrowRight, Coins, Search, Sparkles, Star, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { KINDS, type ListingKind } from "@/lib/marketplace/listing";
import { useCatalog, type CatalogItem } from "@/components/marketplace/catalog";
import {
  CardSkeleton,
  EmptyState,
  KIND_STYLE,
  ListingCard,
  MarketNav,
  StatTile,
} from "@/components/marketplace/ui";
import { chainConfig } from "@/lib/chains";
import { useNetworkPref } from "@/lib/active-chain";

const kinds = ["template", "app", "skill", "ui-kit"] as const;

const search = z.object({
  kind: z.enum(kinds).optional(),
  q: z.string().max(100).optional(),
});

export const Route = createFileRoute("/launchkit/marketplace/")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Marketplace: DevStation" },
      {
        name: "description",
        content:
          "Contract templates, apps, agent skills and UI kits from builders on QIE. Buy with QIE or QUSDC, or sell your own.",
      },
    ],
  }),
  component: Browse,
});

type PriceFilter = "all" | "free" | "paid";
type CurrencyFilter = "all" | "QIE" | "QUSDC";
type Sort = "popular" | "newest" | "price-low" | "price-high";

function popularity(item: CatalogItem) {
  return item.sales * 3 + item.tips * 2 + item.deploys + item.clones + item.downloads;
}

function Browse() {
  const { kind, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/launchkit/marketplace/" });
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const { items, stats, loading, marketLive } = useCatalog();

  const [query, setQuery] = useState(q ?? "");
  const [price, setPrice] = useState<PriceFilter>("all");
  const [currency, setCurrency] = useState<CurrencyFilter>("all");
  const [sort, setSort] = useState<Sort>("popular");

  const setKind = (next: ListingKind | undefined) =>
    void navigate({
      search: (prev: z.infer<typeof search>) => ({ ...prev, kind: next }),
      replace: true,
    });

  const featured = useMemo(() => items.filter((i) => i.featured), [items]);

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    let list = items.filter((item) => {
      if (kind && item.kind !== kind) return false;
      if (price === "free" && item.price !== 0n) return false;
      if (price === "paid" && item.price === 0n) return false;
      if (currency !== "all" && (item.price === 0n || item.currency !== currency)) return false;
      if (!text) return true;
      return (
        item.name.toLowerCase().includes(text) ||
        item.description.toLowerCase().includes(text) ||
        item.tags.some((t) => t.toLowerCase().includes(text)) ||
        (item.category ?? "").toLowerCase().includes(text)
      );
    });
    list = [...list].sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      switch (sort) {
        case "newest":
          return b.createdAt - a.createdAt;
        case "price-low":
          return a.price === b.price ? 0 : a.price < b.price ? -1 : 1;
        case "price-high":
          return a.price === b.price ? 0 : a.price > b.price ? -1 : 1;
        default:
          return popularity(b) - popularity(a);
      }
    });
    return list;
  }, [items, kind, price, currency, query, sort]);

  const countOf = (k: ListingKind) => items.filter((i) => i.kind === k).length;

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/15 via-transparent to-info/10" />
        <div className="relative px-5 py-10 sm:px-8 lg:px-12">
          <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
            DevStation / LaunchKit / Marketplace
          </div>
          <div className="mt-3 flex flex-wrap items-end justify-between gap-6">
            <div className="max-w-2xl">
              <h1 className="font-mono text-2xl font-bold text-foreground sm:text-3xl">
                Build it once. <span className="text-primary">Get paid every time.</span>
              </h1>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                Contract templates, whole apps, agent skills and UI kits from builders on{" "}
                {chainConfig(chainId).name}. Buy in QIE or QUSDC, or list your own work and keep 95%
                of every sale.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                to="/launchkit/marketplace/sell"
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground transition hover:bg-primary-hover"
              >
                <Coins className="h-3.5 w-3.5" /> Start selling
              </Link>
              <Link
                to="/launchkit/marketplace/library"
                className="inline-flex items-center gap-2 rounded border border-border bg-surface/60 px-4 py-2 font-mono text-xs text-foreground transition hover:border-primary hover:text-primary"
              >
                Your library <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
          <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile label="Listings" value={stats.listings} />
            <StatTile label="Creators" value={stats.creators} hint="selling on-chain" />
            <StatTile label="Creator share" value="95%" hint="5% platform fee, tips free" />
            <StatTile label="Pay with" value="QIE · QUSDC" />
          </div>
        </div>
      </section>

      <MarketNav active="browse" />

      <div className="space-y-8 px-5 py-6 sm:px-8 lg:px-12">
        {/* Featured */}
        {featured.length > 0 && !kind && !query && (
          <section>
            <h2 className="mb-3 flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-wider text-foreground">
              <Star className="h-3.5 w-3.5 text-primary" /> Featured
            </h2>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
              {featured.slice(0, 3).map((item) => (
                <ListingCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        )}

        {/* Kinds */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {KINDS.map((k) => {
            const style = KIND_STYLE[k.kind];
            const Icon = style.icon;
            const selected = kind === k.kind;
            return (
              <button
                key={k.kind}
                onClick={() => setKind(selected ? undefined : k.kind)}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left transition",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border bg-surface hover:border-primary/40",
                )}
              >
                <span className={cn("rounded border p-2", style.ring)}>
                  <Icon className={cn("h-4 w-4", style.tone)} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2 font-mono text-sm font-bold text-foreground">
                    {k.label}
                    <span className="font-normal text-meta">{countOf(k.kind)}</span>
                  </span>
                  <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted-foreground">
                    {k.blurb}
                  </span>
                </span>
              </button>
            );
          })}
        </section>

        {/* Filters */}
        <section className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-meta" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, tag or category…"
              className="w-full rounded border border-border bg-background py-2 pl-8 pr-3 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
          </div>
          <Segmented
            value={price}
            onChange={setPrice}
            options={[
              ["all", "Any price"],
              ["free", "Free"],
              ["paid", "Paid"],
            ]}
          />
          <Segmented
            value={currency}
            onChange={setCurrency}
            options={[
              ["all", "Any currency"],
              ["QIE", "QIE"],
              ["QUSDC", "QUSDC"],
            ]}
          />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="popular">Most popular</option>
            <option value="newest">Newest</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </section>

        {/* Grid */}
        <section>
          <div className="mb-3 flex items-center justify-between font-mono text-[11px] text-meta">
            <span>
              {filtered.length} {filtered.length === 1 ? "listing" : "listings"}
              {kind ? ` in ${KINDS.find((k) => k.kind === kind)?.label}` : ""}
            </span>
            {!marketLive && (
              <span>Community listings are on QIE Mainnet: switch networks to see them.</span>
            )}
          </div>
          {loading && items.length === 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
              {Array.from({ length: 6 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Store}
              title="Nothing matches that yet"
              body="Clear the filters, or be the first to list something here."
              action={
                <Link
                  to="/launchkit/marketplace/sell"
                  className="inline-flex items-center gap-2 rounded bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
                >
                  <Sparkles className="h-3.5 w-3.5" /> List something
                </Link>
              }
            />
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
              {filtered.map((item) => (
                <ListingCard key={item.id} item={item} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<readonly [T, string]>;
}) {
  return (
    <div className="flex rounded border border-border bg-background p-0.5">
      {options.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            "rounded px-2.5 py-1.5 font-mono text-[11px] transition",
            value === key
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
