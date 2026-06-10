import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Search, FileCode2, Coins, ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { storage } from "@/lib/storage";
import { useNetworkPref } from "@/lib/active-chain";
import { qieMainnet } from "@/lib/chains";

// Two real QIE Mainnet transactions that show off the inspector without hunting
// for a hash: one with token movements, one with a fully-decoded method call.
const DEMOS = [
  {
    hash: "0x62e6d1771316c6c802f61015b588c5d12bb8fe5f2e7bae2f49de0584d0251da8",
    icon: Coins,
    title: "ERC-20 transfer",
    blurb:
      "A token transfer — decoded transfer(to, amount) call plus 1,000 DMO1 moving in Token Movements.",
  },
  {
    hash: "0x9ad9367de62261ec16c3b80fb4d61308b18c6da0a56ce5433bfaf04706e7ccf9",
    icon: FileCode2,
    title: "ProjectRegistry.recordDeployment(…)",
    blurb: "A registry write — named contract, decoded method, and every argument typed out.",
  },
];

export const Route = createFileRoute("/routebook/")({
  head: () => ({
    meta: [
      { title: "Routebook — DevStation" },
      {
        name: "description",
        content: "Turn any QIE transaction hash into a human-readable execution map.",
      },
    ],
  }),
  component: RoutebookHome,
});

function RoutebookHome() {
  const [hash, setHash] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const navigate = useNavigate();
  const setPreferred = useNetworkPref((s) => s.setPreferred);

  useEffect(() => setRecent(storage.loadInspections()), []);

  const submit = () => {
    if (!hash.trim()) return;
    navigate({ to: "/routebook/$txHash", params: { txHash: hash.trim() } });
  };

  // Demo txs live on Mainnet — switch the active chain so the decoder reads the
  // right network, then open the inspector.
  const openDemo = (h: string) => {
    setPreferred(qieMainnet.id);
    navigate({ to: "/routebook/$txHash", params: { txHash: h } });
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Routebook"]}
        title="Routebook — Transaction Inspector"
        subtitle="Turn any QIE transaction into a readable execution map."
      />
      <div className="p-6">
        <div className="mx-auto max-w-3xl">
          <div className="rounded border border-border bg-surface p-6">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Transaction Hash
              </span>
              <div className="relative mt-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-meta" />
                <input
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Paste a QIE transaction hash... 0x..."
                  className="w-full rounded border border-border bg-background py-3 pl-10 pr-3 font-mono text-sm text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
              </div>
            </label>

            <button
              onClick={submit}
              disabled={!hash.trim()}
              className="mt-3 w-full rounded bg-primary px-4 py-2.5 font-mono text-sm font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              Decode Transaction
            </button>

            {recent.length > 0 && (
              <div className="mt-6">
                <div className="font-mono text-[10px] uppercase tracking-wider text-meta">
                  Recent inspections
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {recent.map((h) => (
                    <Link
                      key={h}
                      to="/routebook/$txHash"
                      params={{ txHash: h }}
                      className="rounded border border-border bg-background p-3 text-left transition hover:border-primary/40"
                    >
                      <TxHashChip hash={h} />
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Try a demo — two real mainnet txs that decode into a named route */}
          <div className="mt-6">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">
              Try a demo transaction
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {DEMOS.map((d) => (
                <button
                  key={d.hash}
                  onClick={() => openDemo(d.hash)}
                  className="group rounded border border-border bg-surface p-4 text-left transition hover:border-primary/50"
                >
                  <div className="flex items-center gap-2">
                    <d.icon className="h-4 w-4 text-primary" />
                    <span className="font-mono text-xs font-bold text-foreground">{d.title}</span>
                    <ArrowRight className="ml-auto h-3.5 w-3.5 text-meta transition group-hover:translate-x-0.5 group-hover:text-primary" />
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{d.blurb}</p>
                  <span className="mt-1 block font-mono text-[10px] text-meta">QIE Mainnet</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-6 rounded border border-border bg-surface p-6 text-center font-mono text-xs text-meta">
            <div className="mb-2 text-2xl">{"{ }"}</div>
            Paste any QIE Testnet or Mainnet transaction hash above to decode its execution route,
            token movements, and approvals — live from the chain.
          </div>
        </div>
      </div>
    </div>
  );
}
