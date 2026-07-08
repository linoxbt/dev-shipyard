import { AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { SUPPORTED_CHAINS } from "@/lib/chains";

// Shows only when the connected wallet is on a chain DevStation doesn't support.
// It does NOT force a specific network — it offers to switch to the user's
// currently-selected one.
export function WrongNetworkBanner() {
  const { walletOnWrongNetwork, chain, select, chainId } = useActiveChain();
  if (!walletOnWrongNetwork) return null;
  const names = SUPPORTED_CHAINS.map((c) => c.name).join(", ");
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs text-warning">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>Your wallet is on an unsupported network. DevStation works with {names}.</span>
      <button onClick={() => select(chainId)} className="ml-auto text-primary hover:underline">
        Switch to {chain.name}
      </button>
    </div>
  );
}
