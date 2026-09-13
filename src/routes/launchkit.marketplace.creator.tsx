import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatEther } from "viem";
import { toast } from "sonner";
import { Coins, Eye, EyeOff, Loader2, Plus, Star, Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useMarketplace, type MarketSummary } from "@/hooks/useMarketplace";
import { useTemplateRegistry } from "@/hooks/useTemplateRegistry";
import { EmptyState, KindBadge, MarketNav, PriceTag, StatTile } from "@/components/marketplace/ui";
import {
  formatAmount,
  formatPrice,
  listingId,
  parsePrice,
  splitSale,
  type Currency,
} from "@/lib/marketplace/listing";

export const Route = createFileRoute("/launchkit/marketplace/creator")({
  head: () => ({ meta: [{ title: "Earnings: DevStation Marketplace" }] }),
  component: CreatorPage,
});

function CreatorPage() {
  const market = useMarketplace();
  const legacy = useTemplateRegistry();
  const [busy, setBusy] = useState<string | null>(null);

  const mine = useMemo(() => {
    const ids = new Set(market.mine);
    return market.summaries.filter((s) => ids.has(s.id));
  }, [market.mine, market.summaries]);

  const gross = useMemo(() => {
    const total: Record<Currency, bigint> = { QIE: 0n, QUSDC: 0n };
    for (const s of mine) {
      total[s.currency] += splitSale(s.price * BigInt(s.sales + s.deploys)).creator;
    }
    return total;
  }, [mine]);

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      toast.error((e instanceof Error ? e.message : "That failed.").split("\n")[0].slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const refresh = () => {
    void market.refetchEarnings();
    void market.refetchSummaries();
    void market.refetchMine();
  };

  if (!market.address) {
    return (
      <Layout>
        <EmptyState
          icon={Wallet}
          title="Connect a wallet"
          body="Earnings and listings belong to the wallet that published them."
        />
      </Layout>
    );
  }

  return (
    <Layout>
      <section className="grid gap-3 md:grid-cols-3">
        <EarningTile
          label="Ready to withdraw"
          amount={market.earnings.QIE}
          currency="QIE"
          busy={busy === "w-QIE"}
          onWithdraw={() =>
            void run("w-QIE", () => market.withdraw("QIE"), "Withdrawn to your wallet").then(
              refresh,
            )
          }
        />
        <EarningTile
          label="Ready to withdraw"
          amount={market.earnings.QUSDC}
          currency="QUSDC"
          busy={busy === "w-QUSDC"}
          onWithdraw={() =>
            void run("w-QUSDC", () => market.withdraw("QUSDC"), "Withdrawn to your wallet").then(
              refresh,
            )
          }
        />
        <StatTile
          label="Earned from sales, all time"
          value={
            <span className="text-base">
              {formatAmount(gross.QIE, "QIE")} QIE · {formatAmount(gross.QUSDC, "QUSDC")} QUSDC
            </span>
          }
          hint="Your 95%, before tips"
        />
      </section>

      {legacy.earnings > 0n && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3">
          <span className="font-mono text-xs text-foreground">
            {formatEther(legacy.earnings)} QIE waiting from your older template listings
          </span>
          <button
            onClick={() =>
              void run("legacy", () => legacy.withdraw(), "Withdrawn").then(() =>
                legacy.refetchEarnings(),
              )
            }
            disabled={busy === "legacy"}
            className="rounded border border-border px-3 py-1.5 font-mono text-xs text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {busy === "legacy" ? "Withdrawing…" : "Withdraw"}
          </button>
        </div>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
            Your listings
          </h2>
          <Link
            to="/launchkit/marketplace/sell"
            className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="h-3.5 w-3.5" /> New listing
          </Link>
        </div>
        {mine.length === 0 ? (
          <EmptyState
            icon={Coins}
            title="No listings yet"
            body="List a template, app, skill or UI kit and your sales show up here."
          />
        ) : (
          <div className="space-y-3">
            {mine.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                busy={busy}
                run={run}
                onDone={refresh}
              />
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Marketplace", "Earnings"]}
        title="Earnings"
        subtitle="What you have sold, what you are owed, and how your listings are doing."
      />
      <MarketNav active="creator" />
      <div className="space-y-6 px-5 py-6 sm:px-8 lg:px-12">{children}</div>
    </div>
  );
}

function EarningTile({
  label,
  amount,
  currency,
  busy,
  onWithdraw,
}: {
  label: string;
  amount: bigint;
  currency: Currency;
  busy: boolean;
  onWithdraw: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-3 rounded-lg border border-border bg-surface p-4">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
          {label} · {currency}
        </div>
        <div className="mt-1 font-mono text-2xl font-bold text-foreground">
          {formatAmount(amount, currency)} <span className="text-sm text-meta">{currency}</span>
        </div>
      </div>
      <button
        onClick={onWithdraw}
        disabled={busy || amount === 0n}
        className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Wallet className="h-3.5 w-3.5" />
        )}
        Withdraw
      </button>
    </div>
  );
}

function ListingRow({
  listing,
  busy,
  run,
  onDone,
}: {
  listing: MarketSummary;
  busy: string | null;
  run: (label: string, fn: () => Promise<unknown>, done: string) => Promise<void>;
  onDone: () => void;
}) {
  const market = useMarketplace();
  const [priceInput, setPriceInput] = useState(
    formatAmount(listing.price, listing.currency).replace(/,/g, ""),
  );
  const [days, setDays] = useState(7);
  const perDay = market.featuredPrices[listing.currency];
  const featuredLeft = listing.featuredUntil > Date.now();

  const save = (active: boolean) =>
    run(
      `save-${listing.id}`,
      async () => {
        const price = parsePrice(priceInput, listing.currency);
        if (price === null) throw new Error(`Enter a price in ${listing.currency}.`);
        const full = await market.fetchListing(listing.id);
        await market.update(listing.id, price, active, full?.metadata ?? {});
      },
      active === listing.active ? "Price saved" : active ? "Listed again" : "Unlisted",
    ).then(onDone);

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={listing.kind} />
            {!listing.active && (
              <span className="font-mono text-[10px] uppercase text-warning">Unlisted</span>
            )}
            {listing.hidden && (
              <span className="font-mono text-[10px] uppercase text-danger">Taken down</span>
            )}
            {featuredLeft && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-primary">
                <Star className="h-3 w-3" /> Featured until{" "}
                {new Date(listing.featuredUntil).toLocaleDateString()}
              </span>
            )}
          </div>
          <Link
            to="/launchkit/marketplace/$listingId"
            params={{ listingId: listingId("market", listing.id) }}
            className="mt-2 block truncate font-mono text-sm font-bold text-foreground hover:text-primary"
          >
            {listing.name}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[11px] text-meta">
            <PriceTag item={listing} />
            <span>{listing.sales} sales</span>
            {listing.model === "per-deploy" && <span>{listing.deploys} deploys</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded border border-border bg-background">
            <input
              value={priceInput}
              onChange={(e) => setPriceInput(e.target.value)}
              inputMode="decimal"
              className="w-24 bg-transparent px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
              aria-label="Price"
            />
            <span className="px-2 font-mono text-[10px] text-meta">{listing.currency}</span>
          </div>
          <button
            onClick={() => void save(listing.active)}
            disabled={busy === `save-${listing.id}`}
            className="rounded border border-border px-2.5 py-1.5 font-mono text-xs text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            Save price
          </button>
          <button
            onClick={() => void save(!listing.active)}
            disabled={busy === `save-${listing.id}`}
            className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {listing.active ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {listing.active ? "Unlist" : "List"}
          </button>
        </div>
      </div>

      {listing.active && !listing.hidden && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Star className="h-3.5 w-3.5 text-primary" />
          <span className="font-mono text-[11px] text-muted-foreground">
            Feature at the top of the marketplace for
          </span>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
          >
            {[1, 3, 7, 14, 30].map((d) => (
              <option key={d} value={d}>
                {d} {d === 1 ? "day" : "days"}
              </option>
            ))}
          </select>
          <span className="font-mono text-[11px] text-meta">
            {perDay > 0n
              ? `= ${formatPrice(perDay * BigInt(days), listing.currency)}`
              : "(not open yet)"}
          </span>
          <button
            onClick={() =>
              void run(
                `feature-${listing.id}`,
                () => market.feature(listing, days),
                `Featured for ${days} days`,
              ).then(onDone)
            }
            disabled={perDay === 0n || busy === `feature-${listing.id}`}
            className="ml-auto inline-flex items-center gap-1.5 rounded bg-primary/15 px-3 py-1.5 font-mono text-xs font-bold text-primary hover:bg-primary/25 disabled:opacity-40"
          >
            {busy === `feature-${listing.id}` && <Loader2 className="h-3 w-3 animate-spin" />}
            Feature it
          </button>
        </div>
      )}
    </div>
  );
}
