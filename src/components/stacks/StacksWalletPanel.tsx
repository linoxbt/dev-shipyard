// Stacks wallet panel — the in-app generated ("DevStation") wallet (unlock /
// generate) plus external wallets (Leather/Xverse/Hiro). Shows address, testnet
// faucet link, and lock/disconnect. The Stacks counterpart to
// WalletPanel / SolanaWalletPanel / SuiWalletPanel.

import { useState } from "react";
import { Wallet, LogOut, Lock, Copy, Check, Droplet } from "lucide-react";
import { ConnectModal } from "@/components/web3/ConnectModal";
import { GenerateStacksDialog } from "@/components/stacks/GenerateStacksDialog";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { useStacksBurner } from "@/lib/stacks/burner/store";
import { useStacksPref } from "@/lib/stacks/active-stacks";
import { stacksChain } from "@/lib/stacks/chains";
import { truncateAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";

export function StacksWalletPanel({ className }: { className?: string }) {
  const wallet = useStacksWallet();
  const network = useStacksPref((s) => s.network);
  const chain = stacksChain(network);
  const burnerExists = useStacksBurner((s) => s.exists);
  const burnerUnlocked = useStacksBurner((s) => s.unlocked);
  const [showConnect, setShowConnect] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [copied, setCopied] = useState(false);

  if (wallet.connected && wallet.address) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 rounded border border-border bg-background px-2.5 py-2 font-mono text-xs">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          <span className="text-foreground">{truncateAddress(wallet.address, 5, 5)}</span>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(wallet.address!);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="text-meta hover:text-foreground"
            title="Copy address"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
          <span className="ml-auto text-meta">{chain.network}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-meta">
            {wallet.source === "burner" ? "DevStation wallet" : "Stacks wallet"}
          </span>
          {chain.faucetUrl && (
            <a
              href={chain.faucetUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] text-meta hover:border-primary hover:text-primary"
            >
              <Droplet className="h-3 w-3" /> Faucet
            </a>
          )}
          <button
            onClick={wallet.disconnect}
            className="ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] text-meta hover:border-danger hover:text-danger"
          >
            {wallet.source === "burner" ? <Lock className="h-3 w-3" /> : <LogOut className="h-3 w-3" />}
            {wallet.source === "burner" ? "Lock" : "Disconnect"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {burnerExists && !burnerUnlocked && (
        <button
          onClick={() => setShowGenerate(true)}
          className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground hover:border-primary/50"
        >
          <Lock className="h-3.5 w-3.5 text-primary" /> Unlock Stacks wallet
        </button>
      )}
      <button
        onClick={() => setShowGenerate(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <Wallet className="h-3.5 w-3.5" /> {burnerExists ? "Manage Stacks Wallet" : "Generate Stacks Wallet"}
      </button>
      <button
        onClick={() => setShowConnect(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
      >
        Connect Leather / Xverse
      </button>
      {showGenerate && <GenerateStacksDialog onClose={() => setShowGenerate(false)} />}
      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}
