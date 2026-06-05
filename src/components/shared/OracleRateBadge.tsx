import { ORACLE_RATE_USD, formatUsd } from "@/lib/chain";
import { cn } from "@/lib/utils";

export function OracleRateBadge({ qieAmount, className }: { qieAmount: number; className?: string }) {
  const usd = qieAmount * ORACLE_RATE_USD;
  return (
    <span
      className={cn("font-mono text-[10px] text-meta", className)}
      title="Live rate via QIE Oracle"
    >
      ≈ {formatUsd(usd)} USD
    </span>
  );
}
