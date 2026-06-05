import { AlertTriangle } from "lucide-react";
import { useWallet, QIE_CHAIN_ID } from "@/lib/wallet";

export function WrongNetworkBanner() {
  const { connected, chainId, switchToQIE } = useWallet();
  if (!connected || chainId === QIE_CHAIN_ID) return null;
  return (
    <div className="flex items-center gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 font-mono text-xs text-warning">
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>
        You're connected to chain {chainId}. DevStation requires QIE Testnet (Chain {QIE_CHAIN_ID}).
      </span>
      <button onClick={switchToQIE} className="ml-2 text-primary hover:underline">
        Switch Network
      </button>
    </div>
  );
}
