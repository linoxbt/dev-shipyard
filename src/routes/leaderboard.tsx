import { createFileRoute, Link } from "@tanstack/react-router";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Trophy, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { getLeaderboard } from "@/lib/api/profile.functions";
import { useNetworkPref } from "@/lib/active-chain";
import { chainConfig } from "@/lib/chains";
import { shortAddr } from "@/lib/explorer/format";
import { TIER_LABEL } from "@/lib/reputation";

// Developer leaderboard, ranked by deployments recorded on ProjectRegistry.
//
// Everything shown is on-chain. Nobody can raise their own position by editing
// a profile: a rank is a count of successful recordDeployment transactions, and
// reverted ones are excluded so failed transactions cannot inflate anyone.

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
    queryFn: () => getLeaderboard({ data: { chainId, limit: 25 } }),
    // The explorer's tx list is the source; refetching it constantly costs the
    // explorer far more than the freshness is worth.
    staleTime: 60_000,
  });

  const entries = data?.entries ?? [];

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Leaderboard"]}
        title="Developer leaderboard"
        subtitle={`Ranked by contracts deployed through DevStation on ${chain.name}.`}
      />
      <div className="p-4 sm:p-6">
        {isLoading ? (
          <p className="font-mono text-xs text-muted-foreground">Reading the registry…</p>
        ) : !data?.available ? (
          <div className="rounded border border-dashed border-border p-12 text-center">
            <Users className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              {data?.reason === "no_registry"
                ? `No project registry is deployed on ${chain.name}.`
                : "The explorer is unreachable, so rankings cannot be read right now."}
            </p>
            <p className="mt-1 font-mono text-[10px] text-meta">
              Rankings come from chain, so there is nothing to show without it.
            </p>
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded border border-dashed border-border p-12 text-center">
            <Trophy className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              No deployments recorded on {chain.name} yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full min-w-[520px] text-left font-mono text-xs">
              <thead className="border-b border-border bg-surface-2 text-meta">
                <tr>
                  <th className="px-3 py-2 font-normal">#</th>
                  <th className="px-3 py-2 font-normal">Developer</th>
                  <th className="px-3 py-2 font-normal">Tier</th>
                  <th className="px-3 py-2 text-right font-normal">Contracts</th>
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
                          {shortAddr(e.address)}
                        </Link>
                        {isYou && <span className="ml-2 text-[10px] text-meta">you</span>}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{TIER_LABEL[e.tier]}</td>
                      <td className="px-3 py-2 text-right text-foreground">{e.deployments}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
