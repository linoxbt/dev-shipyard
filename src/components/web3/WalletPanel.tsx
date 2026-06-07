import { useState } from "react";
import { Copy, Check, Wallet, LogOut, Fuel } from "lucide-react";
import { useAccount, useBalance, useDisconnect } from "wagmi";
import { truncateAddress } from "@/lib/wallet";
import { gasLink } from "@/lib/chains";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useQusdcBalance } from "@/hooks/useQusdc";
import { ConnectModal } from "./ConnectModal";

// Native balance below this (in QIE) is treated as "too low for gas".
const LOW_GAS_THRESHOLD = 0.01;

// Sidebar wallet section: connect via QIE Wallet / MetaMask / generated wallet,
// then show live native balance, QUSDC reference balance, and a get-gas link.
export function WalletPanel() {
  const { address, isConnected } = useAccount();
  const { chainId } = useActiveChain();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({
    address,
    chainId,
    query: { enabled: isConnected, refetchInterval: 30_000 },
  });
  const qusdc = useQusdcBalance(address, chainId);
  const [copied, setCopied] = useState(false);
  const [showConnect, setShowConnect] = useState(false);

  const copyAddr = () => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (!isConnected || !address) {
    return (
      <>
        <button
          onClick={() => setShowConnect(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
        >
          <Wallet className="h-3.5 w-3.5" /> Connect Wallet
        </button>
        {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
      </>
    );
  }

  const lowGas = balance ? Number(balance.formatted) < LOW_GAS_THRESHOLD : false;
  const gas = gasLink(chainId);

  return (
    <>
      <button
        onClick={copyAddr}
        className="group flex w-full items-center gap-2 rounded border border-border bg-background px-2 py-1.5 text-left transition hover:border-primary/50"
      >
        <span className="h-2 w-2 rounded-full bg-success" />
        <span className="font-mono text-xs text-foreground">{truncateAddress(address)}</span>
        {copied ? (
          <Check className="ml-auto h-3 w-3 text-success" />
        ) : (
          <Copy className="ml-auto h-3 w-3 text-meta group-hover:text-muted-foreground" />
        )}
      </button>

      <div className="mt-2 space-y-1 font-mono text-[10px]">
        <div className="flex items-center justify-between">
          <span className="text-meta">QIE</span>
          <span className="text-muted-foreground">
            {balance ? Number(balance.formatted).toFixed(4) : "…"}
          </span>
        </div>
        {qusdc && (
          <div className="flex items-center justify-between">
            <span className="text-meta">QUSDC</span>
            <span className="text-muted-foreground">{qusdc.formatted}</span>
          </div>
        )}
      </div>

      {lowGas && (
        <a
          href={gas.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center justify-center gap-1 rounded border border-warning/40 bg-warning/10 px-2 py-1 font-mono text-[10px] text-warning hover:bg-warning/20"
        >
          <Fuel className="h-3 w-3" /> {gas.label}
        </a>
      )}

      <div className="mt-2 flex items-center justify-end">
        <button
          onClick={() => disconnect()}
          className="flex items-center gap-1 font-mono text-[10px] text-meta hover:text-danger"
        >
          <LogOut className="h-3 w-3" /> Disconnect
        </button>
      </div>
    </>
  );
}
