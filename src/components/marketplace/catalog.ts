import { useMemo } from "react";
import { TEMPLATES, templateLabel } from "@/lib/data/templates";
import { OFFICIAL_LISTINGS } from "@/lib/data/marketplace/official";
import { applyTerminology } from "@/lib/terminology";
import { useTemplateDeploys } from "@/hooks/useTemplateDeploys";
import { useTemplateRegistry } from "@/hooks/useTemplateRegistry";
import { useMarketplace } from "@/hooks/useMarketplace";
import { useMarketplaceStats } from "@/hooks/useMarketplaceStats";
import { useNetworkPref } from "@/lib/active-chain";
import {
  listingId,
  type Currency,
  type ListingKind,
  type ListingSource,
  type PricingModel,
} from "@/lib/marketplace/listing";

// Everything the marketplace shows, from its three sources, in one shape.
//
// Built-in templates ship with DevStation and are free. Legacy listings live in
// the older TemplateRegistry, priced per deploy in QIE. Market listings are the
// new DevStationMarketplace, any kind and either currency. A page filters and
// sorts this list; it never needs to know where an item came from.

export interface CatalogItem {
  id: string;
  source: ListingSource;
  /** The number or slug inside its source. */
  key: string | number;
  kind: ListingKind;
  name: string;
  /** Empty for market listings in the summary: cards load it lazily. */
  description: string;
  creator: string | null;
  official: boolean;
  price: bigint;
  currency: Currency;
  model: PricingModel;
  sales: number;
  deploys: number;
  /** Tips from people other than the creator. Market listings only. */
  tips: number;
  /** Cloned into the App Builder, or opened in the Editor. */
  clones: number;
  downloads: number;
  createdAt: number;
  featured: boolean;
  category: string | null;
  tags: string[];
}

type BaseItem = Omit<CatalogItem, "tips" | "clones" | "downloads">;

export function useCatalog() {
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const { counts } = useTemplateDeploys();
  const legacy = useTemplateRegistry();
  const market = useMarketplace();
  const { data: activity } = useMarketplaceStats();

  const items = useMemo<CatalogItem[]>(() => {
    const now = Date.now();
    const builtins: BaseItem[] = TEMPLATES.map((t) => ({
      id: listingId("builtin", t.id),
      source: "builtin",
      key: t.id,
      kind: "template",
      name: templateLabel(t, chainId),
      description: applyTerminology(t.description, chainId),
      creator: null,
      official: true,
      price: 0n,
      currency: "QIE",
      model: "one-time",
      sales: 0,
      deploys: counts[t.id] ?? t.deployCount,
      createdAt: 0,
      featured: false,
      category: t.category,
      tags: t.tags,
    }));

    const older: BaseItem[] = legacy.summaries
      .filter((s) => s.active)
      .map((s) => ({
        id: listingId("legacy", s.id),
        source: "legacy",
        key: s.id,
        kind: "template",
        name: s.name,
        description: "",
        creator: s.creator,
        official: false,
        price: s.price,
        currency: "QIE",
        model: "per-deploy",
        sales: 0,
        deploys: s.deployCount,
        createdAt: 0,
        featured: false,
        category: null,
        tags: [],
      }));

    const listed: BaseItem[] = market.summaries
      .filter((s) => s.active && !s.hidden)
      .map((s) => ({
        id: listingId("market", s.id),
        source: "market",
        key: s.id,
        kind: s.kind,
        name: s.name,
        description: "",
        creator: s.creator,
        official: false,
        price: s.price,
        currency: s.currency,
        model: s.model,
        sales: s.sales,
        deploys: s.deploys,
        createdAt: s.createdAt,
        featured: s.featuredUntil > now,
        category: null,
        tags: [],
      }));

    // Official apps, skills and UI kits: free, and shipped with DevStation.
    const officials: BaseItem[] = OFFICIAL_LISTINGS.map((l) => ({
      id: listingId("builtin", l.slug),
      source: "builtin",
      key: l.slug,
      kind: l.kind,
      name: l.name,
      description: l.description,
      creator: null,
      official: true,
      price: 0n,
      currency: "QIE",
      model: "one-time",
      sales: 0,
      deploys: 0,
      createdAt: 0,
      featured: false,
      category: l.category,
      tags: l.tags,
    }));

    return [...listed, ...older, ...officials, ...builtins].map((item) => {
      const s = activity?.listings[item.id];
      return { ...item, tips: s?.tips ?? 0, clones: s?.clones ?? 0, downloads: s?.downloads ?? 0 };
    });
  }, [activity, chainId, counts, legacy.summaries, market.summaries]);

  const stats = useMemo(() => {
    const creators = new Set(
      items.filter((i) => i.creator).map((i) => (i.creator as string).toLowerCase()),
    );
    return {
      listings: items.length,
      creators: creators.size,
      community: items.filter((i) => !i.official).length,
      featured: items.filter((i) => i.featured).length,
    };
  }, [items]);

  return {
    items,
    stats,
    loading: legacy.loading || market.loading,
    marketLive: market.configured,
  };
}
