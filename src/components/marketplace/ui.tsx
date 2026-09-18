import type { ComponentType, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  AppWindow,
  BadgeCheck,
  Copy,
  FileCode2,
  Heart,
  LayoutTemplate,
  Rocket,
  ShoppingBag,
  Star,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { formatPrice, kindInfo, type ListingKind } from "@/lib/marketplace/listing";
import { useMarketplace } from "@/hooks/useMarketplace";
import type { CatalogItem } from "./catalog";
import { BuilderName } from "@/components/builder/BuilderName";

// The marketplace's building blocks. Kept to the app's own tokens (amber
// primary, mono type, surface and border) so the store reads as part of
// DevStation rather than a page borrowed from somewhere else.

export const KIND_STYLE: Record<
  ListingKind,
  { icon: ComponentType<{ className?: string }>; tone: string; ring: string; glow: string }
> = {
  template: {
    icon: FileCode2,
    tone: "text-primary",
    ring: "border-primary/40 bg-primary/10",
    glow: "from-primary/15",
  },
  app: {
    icon: AppWindow,
    tone: "text-info",
    ring: "border-info/40 bg-info/10",
    glow: "from-info/15",
  },
  skill: {
    icon: Wand2,
    tone: "text-success",
    ring: "border-success/40 bg-success/10",
    glow: "from-success/15",
  },
  "ui-kit": {
    icon: LayoutTemplate,
    tone: "text-warning",
    ring: "border-warning/40 bg-warning/10",
    glow: "from-warning/15",
  },
};

export function KindBadge({ kind, className }: { kind: ListingKind; className?: string }) {
  const style = KIND_STYLE[kind];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        style.ring,
        style.tone,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {kindInfo(kind).singular}
    </span>
  );
}

export function PriceTag({
  item,
  className,
}: {
  item: Pick<CatalogItem, "price" | "currency" | "model">;
  className?: string;
}) {
  const free = item.price === 0n;
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 rounded px-2 py-0.5 font-mono text-xs font-bold",
        free ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
        className,
      )}
    >
      {formatPrice(item.price, item.currency)}
      {!free && item.model === "per-deploy" && (
        <span className="text-[10px] font-normal opacity-80">/ deploy</span>
      )}
    </span>
  );
}

/** A market listing's description, read on demand: the summary page leaves
 *  the long strings out, so a card fetches its own when it renders. */
function useDescription(item: CatalogItem): string {
  const market = useMarketplace();
  const { data } = useQuery({
    queryKey: ["marketplace", "description", market.chainId, item.key],
    enabled: item.source === "market" && !item.description && market.configured,
    staleTime: 5 * 60_000,
    queryFn: async () => (await market.fetchListing(Number(item.key)))?.description ?? "",
  });
  return item.description || data || kindInfo(item.kind).blurb;
}

export function ListingCard({ item }: { item: CatalogItem }) {
  const style = KIND_STYLE[item.kind];
  const description = useDescription(item);
  return (
    <Link
      to="/launchkit/marketplace/$listingId"
      params={{ listingId: item.id }}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-lg border bg-surface p-3 transition",
        "hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-[0_8px_30px_-12px] hover:shadow-primary/30",
        item.featured ? "border-primary/40" : "border-border",
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent opacity-0 transition group-hover:opacity-100",
          style.glow,
        )}
      />
      <div className="relative flex items-start justify-between gap-2">
        <KindBadge kind={item.kind} />
        <div className="flex items-center gap-1.5">
          {item.featured && (
            <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-primary-foreground">
              <Star className="h-3 w-3" /> Featured
            </span>
          )}
          {item.official && (
            <span
              className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-success"
              title="Ships with DevStation. Not a third-party audit."
            >
              <BadgeCheck className="h-3 w-3" /> Official
            </span>
          )}
        </div>
      </div>

      <h3 className="relative mt-2 line-clamp-1 font-mono text-sm font-bold text-foreground">
        {item.name}
      </h3>
      <p className="relative mt-1 line-clamp-2 min-h-[2rem] text-[11px] leading-relaxed text-muted-foreground">
        {description}
      </p>

      {item.tags.length > 0 && (
        <div className="relative mt-2 flex flex-wrap gap-1">
          {item.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="relative mt-auto flex items-center justify-between gap-2 border-t border-border pt-2 font-mono text-[10px] text-meta">
        <span className="truncate">
          {item.official ? (
            "by DevStation"
          ) : item.creator ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              by <BuilderName address={item.creator} link={false} />
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {item.price > 0n && <Stat icon={ShoppingBag} value={item.sales} label="sold" />}
          {item.kind === "template" && <Stat icon={Rocket} value={item.deploys} label="deploys" />}
          {item.source === "market" && <Stat icon={Heart} value={item.tips} label="tips" />}
          <Stat icon={Copy} value={item.clones + item.downloads} label="clones and downloads" />
          <PriceTag item={item} />
        </span>
      </div>
    </Link>
  );
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  value: number;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} ${label}`}>
      <Icon className="h-3 w-3" /> {value}
    </span>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex h-36 animate-pulse flex-col rounded-lg border border-border bg-surface p-3">
      <div className="h-4 w-24 rounded bg-surface-2" />
      <div className="mt-4 h-5 w-2/3 rounded bg-surface-2" />
      <div className="mt-3 h-3 w-full rounded bg-surface-2" />
      <div className="mt-2 h-3 w-4/5 rounded bg-surface-2" />
      <div className="mt-auto h-4 w-full rounded bg-surface-2" />
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface/70 px-4 py-3 backdrop-blur">
      <div className="font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="mt-1 font-mono text-xl font-bold text-foreground">{value}</div>
      {hint && <div className="mt-0.5 font-mono text-[10px] text-meta">{hint}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/50 px-6 py-14 text-center">
      <Icon className="mx-auto h-7 w-7 text-meta" />
      <p className="mt-3 font-mono text-sm text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{body}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/** Tabs across the marketplace's own pages. */
export function MarketNav({ active }: { active: "browse" | "sell" | "creator" | "library" }) {
  const tabs = [
    { key: "browse", label: "Browse", to: "/launchkit/marketplace" },
    { key: "sell", label: "Sell", to: "/launchkit/marketplace/sell" },
    { key: "creator", label: "Earnings", to: "/launchkit/marketplace/creator" },
    { key: "library", label: "Library", to: "/launchkit/marketplace/library" },
  ] as const;
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border px-5 sm:px-8 lg:px-12">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          to={tab.to}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2.5 font-mono text-xs transition",
            active === tab.key
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
