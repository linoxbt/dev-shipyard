import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { ChainLogo } from "@/lib/chain-logos";
import { useNetworkStatus } from "@/hooks/useChainData";
import { qieMainnet, qieTestnet, botMainnet, botTestnet } from "@/lib/chains";
import { cn } from "@/lib/utils";

// The two chains DevStation is built on, side by side and the same size.
//
// Equal weight is the whole design: same column width, same fields, same live
// status, in the order they are declared. A visitor reading this should not be
// able to tell which one came first, because by now neither is an add-on, both
// carry the full toolchain, their own registries and their own explorer.

const FAMILIES = [
  {
    family: "qie",
    label: "QIE",
    mainnet: qieMainnet,
    testnet: qieTestnet,
    explorer: "QIE Explorer",
    slug: "mainnet" as const,
    blurb: "Deploy, verify and inspect against live QIE networks, with every record kept onchain.",
  },
  {
    family: "bot",
    label: "BOT Chain",
    mainnet: botMainnet,
    testnet: botTestnet,
    explorer: "BOTScan",
    slug: "bot-mainnet" as const,
    blurb: "The same editor, the same registries, the same explorer, running natively on BOT.",
  },
];

function StatusDot({ chainId }: { chainId: number }) {
  const { data } = useNetworkStatus(chainId);
  const online = data?.status === "online";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-meta">
      <i
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          online ? "bg-success" : "bg-border",
          online && "animate-pulse",
        )}
      />
      {online ? "live" : "-"}
    </span>
  );
}

export function ChainsBand() {
  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl py-14 px-5 sm:px-8 lg:px-11">
        <div className="max-w-2xl">
          <div className="font-mono text-[11px] uppercase tracking-wider text-primary">
            Two chains, one console
          </div>
          <h2 className="mt-2 font-mono text-2xl font-bold text-foreground sm:text-3xl">
            Built on QIE and BOT Chain
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Not a primary chain with a second one bolted on. Both are first-class targets: the same
            templates compile, the same deployments are recorded onchain, and the same explorer
            reads them back.
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {FAMILIES.map((f) => (
            <div
              key={f.label}
              className="rounded-lg border border-border bg-surface p-5 transition hover:border-primary/50"
            >
              <div className="flex items-center gap-2.5">
                <ChainLogo family={f.family} size={22} />
                <span className="font-mono text-sm font-bold text-foreground">{f.label}</span>
                <span className="ml-auto">
                  <StatusDot chainId={f.mainnet.id} />
                </span>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.blurb}</p>

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border pt-4 font-mono text-[11px]">
                <div>
                  <dt className="text-meta">Mainnet</dt>
                  <dd className="text-foreground">{f.mainnet.id}</dd>
                </div>
                <div>
                  <dt className="text-meta">Testnet</dt>
                  <dd className="text-foreground">{f.testnet.id}</dd>
                </div>
                <div>
                  <dt className="text-meta">Gas token</dt>
                  <dd className="text-foreground">{f.mainnet.nativeCurrency.symbol}</dd>
                </div>
                <div>
                  <dt className="text-meta">Explorer</dt>
                  <dd className="text-foreground">{f.explorer}</dd>
                </div>
              </dl>

              <Link
                to="/explorer/$network"
                params={{ network: f.slug }}
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-[11px] text-primary hover:underline"
              >
                Open the {f.label} explorer
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
