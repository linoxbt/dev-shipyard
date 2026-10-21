import { AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { chainById } from "@/lib/active-chain";

// Shows when the connected wallet is on a different chain from the selected
// one: loudly when that chain is unsupported, quietly when it is a supported
// chain that simply is not the one selected (reads follow the selection, but a
// transaction would be sent on the wallet's chain, so the user should know).
// It does NOT force a specific network: it offers to switch to the user's
// currently-selected one.
export function WrongNetworkBanner() {
  const { walletOnWrongNetwork, walletMismatch, walletChainId, chain, select, chainId } =
    useActiveChain();
  if (!walletOnWrongNetwork && !walletMismatch) return null;
  const names = SUPPORTED_CHAINS.map((c) => c.name).join(", ");
  const walletChain = walletChainId != null ? chainById(walletChainId) : undefined;
  return (
    <div
      role="status"
      className={
        walletOnWrongNetwork
          ? "flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs text-warning"
          : "flex flex-wrap items-center gap-2 border-b border-border bg-surface px-4 py-1.5 font-mono text-[11px] text-muted-foreground"
      }
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        {walletOnWrongNetwork
          ? `Your wallet is on an unsupported network. DevStation works with ${names}.`
          : `Viewing ${chain.name}; your wallet is on ${walletChain?.name ?? "another network"}. Transactions need the same network.`}
      </span>
      <button onClick={() => select(chainId)} className="ml-auto text-primary hover:underline">
        Switch wallet to {chain.name}
      </button>
    </div>
  );
}
