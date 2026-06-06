import { AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";

// Shows only when the connected wallet is on a chain DevStation doesn't support
// (i.e. neither QIE Testnet nor Mainnet). It does NOT force a specific QIE
// network — it offers to switch to the user's currently-selected one.
export function WrongNetworkBanner() {
  const { walletOnWrongNetwork, chain, select, chainId } = useActiveChain();
  if (!walletOnWrongNetwork) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs text-warning">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        Your wallet is on an unsupported network. DevStation works with QIE Testnet & Mainnet.
      </span>
      <button onClick={() => select(chainId)} className="ml-auto text-primary hover:underline">
        Switch to {chain.name}
      </button>
    </div>
  );
}
