import { AlertTriangle } from "lucide-react";
import { useActiveChain } from "@/hooks/useActiveChain";
import { qieTestnet } from "@/lib/chains";

// Persistent amber banner shown app-wide whenever the selected network is QIE
// Mainnet. Dismissible only by switching back to Testnet.
export function MainnetWarningBanner() {
  const { isTestnet, select } = useActiveChain();
  if (isTestnet) return null;

  return (
    <div className="flex items-center gap-2 bg-[#f6a623] px-4 py-1.5 font-mono text-[11px] text-black">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span>
        You are viewing <strong>QIE Mainnet</strong>. Transactions cost real gas and cannot be
        undone.
      </span>
      <button
        onClick={() => select(qieTestnet.id)}
        className="ml-auto shrink-0 rounded bg-black/15 px-2 py-0.5 font-semibold hover:bg-black/25"
      >
        Switch to Testnet
      </button>
    </div>
  );
}
