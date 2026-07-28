import { Link } from "@tanstack/react-router";
import { Cpu } from "lucide-react";
import type { SolanaCluster } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";

// Well-known native + ecosystem programs (same ids across clusters). Each links
// to its on-chain account page.
const PROGRAMS = [
  { name: "System Program", id: "11111111111111111111111111111111" },
  { name: "SPL Token", id: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
  { name: "SPL Token-2022", id: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" },
  { name: "Associated Token Account", id: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" },
  { name: "Memo", id: "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr" },
  { name: "Compute Budget", id: "ComputeBudget111111111111111111111111111111" },
  { name: "Stake Program", id: "Stake11111111111111111111111111111111111111" },
  { name: "Vote Program", id: "Vote111111111111111111111111111111111111111" },
  { name: "BPF Upgradeable Loader", id: "BPFLoaderUpgradeab1e11111111111111111111111" },
  { name: "Metaplex Token Metadata", id: "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" },
];

export function SolanaPrograms({ cluster }: { cluster: SolanaCluster }) {
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Cpu className="h-3.5 w-3.5 text-primary" /> Programs
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-x-4 px-4 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <span>Program</span>
        <span className="text-right">Program Id</span>
      </div>
      {PROGRAMS.map((p) => (
        <Link
          key={p.id}
          to="/explorer/$network/address/$hash"
          params={{ network: cluster, hash: p.id }}
          className="grid grid-cols-[1fr_auto] items-center gap-x-4 border-t border-border px-4 py-2 font-mono text-xs hover:bg-surface-2"
        >
          <span className="text-foreground">{p.name}</span>
          <span className="text-right text-primary">{truncateAddress(p.id, 4, 4)}</span>
        </Link>
      ))}
    </div>
  );
}
