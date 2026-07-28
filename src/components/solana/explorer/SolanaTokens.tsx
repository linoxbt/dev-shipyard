import { Link } from "@tanstack/react-router";
import { Coins, Info } from "lucide-react";
import type { SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

// Curated notable SPL tokens per cluster. A full token list needs an indexer
// (the RPC can't enumerate all mints); paste any mint address into search to
// open its account page, or deploy your own from Templates.
const TOKENS: Record<SolanaCluster, Array<{ symbol: string; name: string; mint: string }>> = {
  "solana-mainnet": [
    { symbol: "SOL", name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112" },
    { symbol: "USDC", name: "USD Coin", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    { symbol: "USDT", name: "Tether USD", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
    { symbol: "JUP", name: "Jupiter", mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
    { symbol: "BONK", name: "Bonk", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  ],
  "solana-devnet": [
    { symbol: "SOL", name: "Wrapped SOL", mint: "So11111111111111111111111111111111111111112" },
    { symbol: "USDC", name: "USD Coin (devnet)", mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" },
  ],
};

export function SolanaTokens({ cluster }: { cluster: SolanaCluster }) {
  const tokens = TOKENS[cluster];
  return (
    <div className="space-y-3">
      <div className="rounded border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
          <Coins className="h-3.5 w-3.5 text-primary" /> Tokens
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
          <span>Symbol</span>
          <span>Name</span>
          <span className="text-right">Mint</span>
        </div>
        {tokens.map((t) => (
          <Link
            key={t.mint}
            to="/explorer/$network/address/$hash"
            params={{ network: cluster, hash: t.mint }}
            className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
          >
            <span className="font-bold text-foreground">{t.symbol}</span>
            <span className="text-muted-foreground">{t.name}</span>
            <span className="text-right text-primary">{truncateAddress(t.mint, 4, 4)}</span>
          </Link>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded border border-border bg-surface-2 p-3 font-mono text-[10px] text-meta">
        <Info className="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          A complete token index requires a chain indexer. Search any mint address to open it, or
          deploy your own SPL token from Templates.
        </span>
      </div>
    </div>
  );
}
