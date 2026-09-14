import { createFileRoute, Link } from "@tanstack/react-router";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Sigma, Trophy, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { getLeaderboard } from "@/lib/api/profile.functions";
import { useNetworkPref } from "@/lib/active-chain";
import { chainConfig } from "@/lib/chains";
import { ACTIVITIES, activityPoints } from "@/lib/leaderboard";
import { TIER_LABEL } from "@/lib/reputation";
import { BuilderName } from "@/components/builder/BuilderName";

// The builder leaderboard: contracts, apps, listings, sales, deploys, tips and
// clones, scored by one published formula (src/lib/leaderboard.ts).
//
// Nobody can type their way up it. Contracts, listings, sales, deploys and tips
// are read from chain; published apps and clones are DevStation's own records,
// and clones count each person once a day. The formula is on the page, so a
// rank can always be checked by hand.

export const Route = createFileRoute("/leaderboard")({
  // Gated on the shared map, never on a flag local to this file: the
  // sidebar badge reads the same entry, so the two cannot disagree.
  // LeaderboardPage stays referenced, so removing the map entry is all it takes
  // to bring the page back.
  component: () =>
    isComingSoon("/leaderboard") ? <ComingSoon path="/leaderboard" /> : <LeaderboardPage />,
});

function LeaderboardPage() {
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const { address } = useAccount();
  const chain = chainConfig(chainId);

  const { data, isLoading } = useQuery({
    queryKey: ["leaderboard", chainId],
    queryFn: () => getLeaderboard({ data: { chainId, limit: 50 } }),
    // Several sources are read for every board; refetching constantly costs
    // them far more than the freshness is worth.
    staleTime: 60_000,
  });

  const entries = data?.available ? data.entries : [];
  const missing = data?.available ? data.missing : [];

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Leaderboard"]}
        title="Builder leaderboard"
        subtitle={`Ranked by everything built with DevStation on ${chain.name}: contracts, apps, listings, sales, deploys, tips and clones.`}
      />
      <div className="space-y-6 px-5 py-4 sm:px-8 sm:py-6 lg:px-12">
        {isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Reading the chain…</p>
        ) : !data?.available ? (
          <div className="rounded border border-dashed border-border p-12 text-center">
            <Users className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Rankings cannot be read right now.
            </p>
            <p className="mt-1 font-mono text-[10px] text-meta">
              Every source the board reads from was unreachable. Try again shortly.
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded border border-dashed border-border p-12 text-center">
            <Trophy className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              Nothing built on {chain.name} yet. The first contract, app or listing takes the top
              spot.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[860px] text-left font-mono text-xs">
              <thead className="border-b border-border bg-surface-2 text-meta">
                <tr>
                  <th className="px-3 py-2 font-normal">#</th>
                  <th className="px-3 py-2 font-normal">Builder</th>
                  <th className="px-3 py-2 font-normal">Tier</th>
                  <th className="px-3 py-2 text-right font-normal text-foreground">Points</th>
                  {ACTIVITIES.map((a) => (
                    <th key={a.key} className="px-3 py-2 text-right font-normal" title={a.counts}>
                      {a.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const isYou = !!address && e.address === address.toLowerCase();
                  return (
                    <tr
                      key={e.address}
                      className={`border-b border-border last:border-0 ${
                        isYou ? "bg-surface-2" : ""
                      }`}
                    >
                      <td className="px-3 py-2 text-meta">{e.rank}</td>
                      <td className="px-3 py-2">
                        <Link
                          to="/dev/$address"
                          params={{ address: e.address }}
                          className="text-foreground hover:underline"
                        >
                          <BuilderName address={e.address} link={false} avatar />
                        </Link>
                        {isYou && <span className="ml-2 text-[10px] text-meta">you</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{TIER_LABEL[e.tier]}</td>
                      <td className="px-3 py-2 text-right font-bold text-foreground">{e.points}</td>
                      {ACTIVITIES.map((a) => {
                        const count = e.counts[a.key];
                        return (
                          <td
                            key={a.key}
                            className={`px-3 py-2 text-right ${
                              count > 0 ? "text-foreground" : "text-meta"
                            }`}
                            title={
                              count > 0
                                ? `${count} × ${a.label.toLowerCase()} = ${Math.round(
                                    activityPoints(a.weight, count),
                                  )} points`
                                : undefined
                            }
                          >
                            {count > 0 ? count : "·"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {data?.available && missing.length > 0 && (
          <p className="font-mono text-[11px] text-meta">
            Not counted right now, because the source did not answer:{" "}
            {missing.map((key) => ACTIVITIES.find((a) => a.key === key)?.label ?? key).join(", ")}.
            Ranks use everything else.
          </p>
        )}

        <Formula />
      </div>
    </div>
  );
}

function Formula() {
  return (
    <section className="rounded border border-border bg-surface p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-mono text-sm font-bold text-foreground">
        <Sigma className="h-4 w-4 text-primary" /> How points work
      </h2>
      <p className="mt-2 font-mono text-xs text-foreground">points = Σ weight × log₂(1 + count)</p>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
        The first of anything earns its full weight, the third earns double, the seventh triple.
        Doing more always helps, but range helps most: a contract, an app, a listing and a sale
        outscore twenty contracts. What other people choose (buying, deploying, tipping) weighs more
        than what a builder does alone, and nothing a builder does to their own listings counts.
        Wallets that run DevStation itself are left off.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left font-mono text-xs">
          <thead className="text-meta">
            <tr className="border-b border-border">
              <th className="py-2 pr-3 font-normal">Activity</th>
              <th className="py-2 pr-3 text-right font-normal">Weight</th>
              <th className="py-2 pr-3 text-right font-normal">1 / 3 / 7</th>
              <th className="py-2 pr-3 font-normal">What counts</th>
              <th className="py-2 font-normal">Source</th>
            </tr>
          </thead>
          <tbody>
            {ACTIVITIES.map((a) => (
              <tr key={a.key} className="border-b border-border last:border-0">
                <td className="py-2 pr-3 text-foreground">{a.label}</td>
                <td className="py-2 pr-3 text-right text-foreground">{a.weight}</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">
                  {[1, 3, 7].map((n) => activityPoints(a.weight, n)).join(" / ")}
                </td>
                <td className="py-2 pr-3 text-muted-foreground">{a.counts}</td>
                <td className="py-2 text-meta">
                  {a.source === "chain" ? "On chain" : "DevStation"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[10px] text-meta">
        Tiers: Builder from 20 points, Regular from 60, Veteran from 120. Ties share a rank.
      </p>
    </section>
  );
}
