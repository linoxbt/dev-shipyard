import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Library, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useMarketplace } from "@/hooks/useMarketplace";
import { useCatalog } from "@/components/marketplace/catalog";
import { CardSkeleton, EmptyState, ListingCard, MarketNav } from "@/components/marketplace/ui";
import { listingId } from "@/lib/marketplace/listing";

export const Route = createFileRoute("/launchkit/marketplace/library")({
  head: () => ({ meta: [{ title: "Your library: DevStation Marketplace" }] }),
  component: LibraryPage,
});

function LibraryPage() {
  const market = useMarketplace();
  const { items, loading } = useCatalog();

  const owned = useMemo(() => {
    const ids = new Set(market.purchases.map((id) => listingId("market", id)));
    return items.filter((item) => ids.has(item.id));
  }, [items, market.purchases]);

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Marketplace", "Library"]}
        title="Your library"
        subtitle="Everything this wallet has bought. Open any of it again, whenever you like."
      />
      <MarketNav active="library" />
      <div className="px-5 py-6 sm:px-8 lg:px-12">
        {!market.address ? (
          <EmptyState
            icon={Wallet}
            title="Connect a wallet"
            body="Your purchases are recorded on-chain against your wallet. Connect it to see them."
          />
        ) : loading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : owned.length === 0 ? (
          <EmptyState
            icon={Library}
            title="Nothing here yet"
            body="Buy a template, app, skill or UI kit and it stays here for good."
            action={
              <Link
                to="/launchkit/marketplace"
                className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
              >
                Browse the marketplace
              </Link>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {owned.map((item) => (
              <ListingCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
