// Per-chain logos for the explorer header (and anywhere a chain mark is shown).
//
// Keyed by the chain family's *label* — the same string the explorer header
// already renders (e.g. "QIE", "BOT Chain").
// Assets live in public/chains/*.svg; drop official brand files there to
// upgrade the look — the mapping and fallback stay the same. Any chain without
// a mapped asset (or whose image fails to load) renders a colored monogram
// badge, so the header always shows *something* before the chain name.

import { useState } from "react";
import { cn } from "@/lib/utils";

interface LogoMeta {
  /** Path under /public, or null to always use the monogram. */
  src: string | null;
  /** Brand color for the monogram fallback background. */
  color: string;
}

// Match against the family label. Keys are lowercased and matched by prefix so
// "BOT Chain" resolves without exact-string coupling.
const LOGOS: Array<{ match: string; meta: LogoMeta }> = [
  // Real per-chain brand logos (fetched into public/chains/).
  { match: "qie", meta: { src: "/chains/qie.png", color: "#0A66FF" } },
  { match: "bot", meta: { src: "/chains/bot.png", color: "#111827" } },
  // Generic EVM mark, for anywhere a non-family-specific chain badge is shown.
  { match: "evm", meta: { src: "/chains/ethereum.svg", color: "#627EEA" } },
  { match: "ethereum", meta: { src: "/chains/ethereum.svg", color: "#627EEA" } },
];

export function chainLogo(familyLabel: string): LogoMeta {
  const key = familyLabel.trim().toLowerCase();
  const hit = LOGOS.find((l) => key.startsWith(l.match));
  return hit?.meta ?? { src: null, color: "#6366F1" };
}

/**
 * The chain's logo, sized for inline use in headers. Falls back to a colored
 * monogram (first letter of the family label) when there's no asset or the
 * image fails to load.
 */
export function ChainLogo({
  family,
  className,
  size = 16,
}: {
  family: string;
  className?: string;
  size?: number;
}) {
  const meta = chainLogo(family);
  const [failed, setFailed] = useState(false);
  const showImg = meta.src && !failed;

  if (showImg) {
    return (
      <img
        src={meta.src!}
        alt={`${family} logo`}
        width={size}
        height={size}
        className={cn("inline-block rounded-[3px] object-contain", className)}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <span
      aria-label={`${family} logo`}
      className={cn(
        "inline-flex items-center justify-center rounded-[3px] font-mono font-bold text-white",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: meta.color, fontSize: size * 0.6 }}
    >
      {family.trim().charAt(0).toUpperCase()}
    </span>
  );
}
