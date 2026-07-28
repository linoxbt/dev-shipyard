// Solana wallet panel — create/unlock the in-app burner, connect an external
// wallet (Phantom/Solflare), show address + balance, and request a devnet
// airdrop. The Solana counterpart to the EVM WalletPanel; used on Solana
// feature pages and in the sidebar's Solana section.

import { useCallback, useEffect, useState } from "react";
import { Wallet, Lock, LogOut, Droplet, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { ConnectModal } from "@/components/web3/ConnectModal";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { useSolanaBurner } from "@/lib/solana/burner/store";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { solanaChain } from "@/lib/solana/chains";
import { truncateAddress } from "@/lib/wallet";
import { cn } from "@/lib/utils";

type Mode = "idle" | "unlock";

export function SolanaWalletPanel({ className }: { className?: string }) {
  const wallet = useSolanaWallet();
  const cluster = useSolanaPref((s) => s.cluster);
  const isDevnet = solanaChain(cluster).cluster === "devnet";

  const burnerExists = useSolanaBurner((s) => s.exists);
  const burnerUnlocked = useSolanaBurner((s) => s.unlocked);
  const unlock = useSolanaBurner((s) => s.unlock);
  const lock = useSolanaBurner((s) => s.lock);

  const [mode, setMode] = useState<Mode>("idle");
  const [showConnect, setShowConnect] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!wallet.connected) return setBalance(null);
    try {
      setBalance(await wallet.getBalanceSol());
    } catch {
      /* RPC hiccup — leave prior value */
    }
  }, [wallet]);

  useEffect(() => {
    refreshBalance();
  }, [refreshBalance, wallet.address, cluster]);

  const doUnlock = async () => {
    setBusy(true);
    try {
      await unlock(password);
      setMode("idle");
      setPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to unlock");
    } finally {
      setBusy(false);
    }
  };

  const doAirdrop = async () => {
    setBusy(true);
    try {
      await wallet.airdrop(1);
      toast.success("Airdropped 1 devnet SOL");
      refreshBalance();
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Airdrop failed (devnet faucet may be rate-limited)",
      );
    } finally {
      setBusy(false);
    }
  };

  const copyAddress = async () => {
    if (!wallet.address) return;
    await navigator.clipboard.writeText(wallet.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  // Connected view
  if (wallet.connected && wallet.address) {
    return (
      <div className={cn("space-y-2", className)}>
        <div className="flex items-center gap-2 rounded border border-border bg-background px-2.5 py-2 font-mono text-xs">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          <span className="text-foreground">{truncateAddress(wallet.address)}</span>
          <button
            onClick={copyAddress}
            className="text-meta hover:text-foreground"
            title="Copy address"
          >
            {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          </button>
          <span className="ml-auto text-meta">
            {balance === null ? "…" : `${balance.toFixed(3)} SOL`}
          </span>
          <button
            onClick={refreshBalance}
            className="text-meta hover:text-foreground"
            title="Refresh balance"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-meta">
            {wallet.source === "adapter" ? "External wallet" : "Burner"}
          </span>
          {isDevnet && (
            <button
              onClick={doAirdrop}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] text-meta hover:border-primary hover:text-primary disabled:opacity-50"
            >
              <Droplet className="h-3 w-3" /> Airdrop
            </button>
          )}
          <button
            onClick={() => (wallet.source === "adapter" ? wallet.disconnectAdapter() : lock())}
            className="ml-auto inline-flex items-center gap-1 rounded border border-border px-1.5 py-1 font-mono text-[10px] text-meta hover:border-danger hover:text-danger"
          >
            {wallet.source === "adapter" ? (
              <LogOut className="h-3 w-3" />
            ) : (
              <Lock className="h-3 w-3" />
            )}
            {wallet.source === "adapter" ? "Disconnect" : "Lock"}
          </button>
        </div>
      </div>
    );
  }

  // Password form (unlock)
  if (mode !== "idle") {
    return (
      <div className={cn("space-y-2", className)}>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doUnlock()}
          placeholder="Password"
          className="w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <button
            onClick={doUnlock}
            disabled={busy}
            className="flex-1 rounded bg-primary px-2 py-1.5 font-mono text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "…" : "Unlock"}
          </button>
          <button
            onClick={() => {
              setMode("idle");
              setPassword("");
            }}
            className="rounded border border-border px-2 py-1.5 font-mono text-xs text-meta hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // Idle: unlock an existing burner, or open the unified two-step connect modal
  // (EVM / Solana / Sui → wallets), matching the rest of the app.
  return (
    <div className={cn("space-y-2", className)}>
      {burnerExists && !burnerUnlocked && (
        <button
          onClick={() => setMode("unlock")}
          className="flex w-full items-center gap-2 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-xs text-foreground hover:border-primary/50"
        >
          <Lock className="h-3.5 w-3.5 text-primary" /> Unlock Solana burner
        </button>
      )}
      <button
        onClick={() => setShowConnect(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
      >
        <Wallet className="h-3.5 w-3.5" /> Connect Wallet
      </button>
      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}
