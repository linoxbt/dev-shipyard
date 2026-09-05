import { useEffect, useRef, useState } from "react";
import { ChainLogo } from "@/lib/chain-logos";
import { cn } from "@/lib/utils";

// The hero's moving picture: the four things DevStation does, each dissolving
// into the next.
//
// The chain alternates every full cycle: QIE, then BOT Chain, then QIE again.
// That is the point of building it this way rather than writing "works on both"
// underneath a static screenshot: a visitor who watches for ten seconds sees the
// same pipeline land on each chain, which is a claim the page demonstrates
// rather than asserts.

const SCENE_MS = 3400;

/** The two chains, at equal weight. Order is fixed so the alternation is
 *  predictable rather than random: a visitor should be able to notice it. */
const CHAINS = [
  { family: "qie", name: "QIE Mainnet", token: "QIE", id: 1990, explorer: "QIE Explorer" },
  { family: "bot", name: "BOT Chain", token: "BOT", id: 677, explorer: "BOTScan" },
] as const;

type Line = { text: string; tone?: "prompt" | "code" | "ok" | "meta" | "warn" };

function scenes(chain: (typeof CHAINS)[number]): Array<{ label: string; lines: Line[] }> {
  return [
    {
      label: "Describe",
      lines: [
        { text: "› build a staking vault with a 7-day lock", tone: "prompt" },
        { text: "understanding the request…", tone: "meta" },
        { text: "one contract, one test suite, one app", tone: "ok" },
      ],
    },
    {
      label: "Write",
      lines: [
        { text: "contract StakingVault is Ownable {", tone: "code" },
        { text: "  mapping(address => uint256) public lockedUntil;", tone: "code" },
        { text: "  function stake() external payable { … }", tone: "code" },
        { text: "solc 0.8.24 · evmVersion shanghai · 0 errors", tone: "ok" },
      ],
    },
    {
      label: "Deploy",
      lines: [
        { text: `target ${chain.name} · chain id ${chain.id}`, tone: "meta" },
        { text: "estimating gas · signing · broadcasting", tone: "meta" },
        { text: "0x7f3a…c19b  confirmed in 2 blocks", tone: "ok" },
        { text: `recorded onchain · gas paid in ${chain.token}`, tone: "ok" },
      ],
    },
    {
      label: "Inspect",
      lines: [
        { text: `open in ${chain.explorer} and Routebook`, tone: "meta" },
        { text: "StakingVault.stake()", tone: "code" },
        { text: "  └─ Transfer(from: 0x00…, value: 25.0)", tone: "code" },
        { text: "verified · labelled · shareable", tone: "ok" },
      ],
    },
  ];
}

const TONE: Record<NonNullable<Line["tone"]>, string> = {
  prompt: "text-foreground",
  code: "text-info",
  ok: "text-primary",
  meta: "text-meta",
  warn: "text-warning",
};

export function HeroStage({ className }: { className?: string }) {
  const [step, setStep] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [paused, setPaused] = useState(false);
  // Honour the OS setting rather than animating regardless. Read once on mount
  // because this decides whether there is a timer at all.
  const reduced = useRef(false);
  useEffect(() => {
    reduced.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
    if (reduced.current) setPaused(true);
  }, []);

  const chain = CHAINS[cycle % CHAINS.length];
  const all = scenes(chain);
  const scene = all[step];

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => {
      setStep((s) => {
        const next = (s + 1) % all.length;
        // A full pass through the pipeline flips the chain, so the next loop
        // shows the identical steps landing somewhere else.
        if (next === 0) setCycle((c) => c + 1);
        return next;
      });
    }, SCENE_MS);
    return () => clearTimeout(t);
  }, [step, paused, all.length]);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-surface shadow-sm",
        className,
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => !reduced.current && setPaused(false)}
    >
      {/* Title bar: the step names double as the progress indicator. */}
      <div className="flex items-center gap-1 border-b border-border bg-background/60 px-3 py-2">
        <span className="mr-1 flex gap-1" aria-hidden>
          <i className="h-2 w-2 rounded-full bg-border" />
          <i className="h-2 w-2 rounded-full bg-border" />
          <i className="h-2 w-2 rounded-full bg-border" />
        </span>
        {all.map((s, i) => (
          <button
            key={s.label}
            type="button"
            onClick={() => setStep(i)}
            className={cn(
              "rounded px-1.5 py-0.5 font-mono text-[10px] transition",
              i === step ? "bg-primary/15 text-primary" : "text-meta hover:text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-meta">
          <ChainLogo family={chain.family} size={12} />
          {chain.name}
        </span>
      </div>

      {/* The scene. Keyed on step+cycle so every change remounts and replays. */}
      <div className="relative min-h-[9.5rem] p-4 sm:min-h-[10.5rem]">
        <div key={`${cycle}-${step}`} className="space-y-1.5">
          {scene.lines.map((line, i) => (
            <p
              key={line.text}
              className={cn(
                "font-mono text-[11px] leading-relaxed sm:text-xs",
                TONE[line.tone ?? "meta"],
                !reduced.current && "animate-fade-up",
              )}
              style={!reduced.current ? { animationDelay: `${i * 110}ms` } : undefined}
            >
              {line.text}
            </p>
          ))}
        </div>
      </div>

      {/* Timer bar. Remounts with the scene, so it always tracks the real wait. */}
      <div className="h-0.5 bg-border/60">
        {!paused && (
          <div
            key={`${cycle}-${step}-bar`}
            className="h-full bg-primary/70"
            style={{ animation: `stage-progress ${SCENE_MS}ms linear both` }}
          />
        )}
      </div>
    </div>
  );
}
