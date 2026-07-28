// Settings "Wallet & Profile" panel for the Solana family — connection state +
// balance, and management (reveal the passphrase — or secret key, for an
// imported wallet — behind the password, lock, remove) for the in-app
// generated Solana burner wallet.

import { useEffect, useState } from "react";
import { Eye, EyeOff, Copy, Check, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SolanaWalletPanel } from "@/components/solana/SolanaWalletPanel";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { useSolanaBurner } from "@/lib/solana/burner/store";
import { useSolanaPref } from "@/lib/solana/active-solana";
import { solanaChain } from "@/lib/solana/chains";
import { copySensitive } from "@/lib/clipboard";

export function SolanaWalletProfile() {
  const wallet = useSolanaWallet();
  const burner = useSolanaBurner();
  const cluster = useSolanaPref((s) => s.cluster);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (wallet.connected)
      wallet
        .getBalanceSol()
        .then(setBalance)
        .catch(() => {});
    else setBalance(null);
  }, [wallet]);

  return (
    <div className="space-y-4">
      {wallet.connected && wallet.address ? (
        <div className="space-y-3">
          <Row label="Status">
            <span className="flex items-center gap-1.5 text-success">
              <span className="h-2 w-2 rounded-full bg-success" /> Connected
              <span className="text-meta">
                · {wallet.source === "adapter" ? "External wallet" : "DevStation burner"}
              </span>
            </span>
          </Row>
          <Row label="Address">
            <span className="break-all text-foreground">{wallet.address}</span>
          </Row>
          <Row label="SOL Balance">
            <span className="text-foreground">
              {balance === null ? "…" : `${balance.toFixed(6)} SOL`}
            </span>
          </Row>
          <Row label="Network">
            <span className="text-foreground">{solanaChain(cluster).name}</span>
          </Row>
        </div>
      ) : (
        <SolanaWalletPanel />
      )}

      {burner.exists && (
        <div className="rounded border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-meta">
              DevStation Solana Wallet
            </span>
            {burner.unlocked && (
              <span className="font-mono text-[10px] text-success">unlocked</span>
            )}
          </div>
          <SolanaBurnerControls />
        </div>
      )}
    </div>
  );
}

function SolanaBurnerControls() {
  const burner = useSolanaBurner();
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState<{ kind: "mnemonic" | "secret"; secret: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    if (!password) return toast.error("Enter your password to reveal it");
    setBusy(true);
    try {
      setRevealed(await burner.reveal(password));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (
      !confirm(
        "Remove this Solana wallet? Back up your passphrase/secret key first — this cannot be undone.",
      )
    )
      return;
    burner.remove();
    setRevealed(null);
    setPassword("");
    toast.success("Solana wallet removed from this browser");
  };

  const label = revealed?.kind === "mnemonic" ? "passphrase" : "secret key";

  return (
    <div className="space-y-2">
      {revealed ? (
        <div className="space-y-2">
          <div className="break-all rounded border border-warning/40 bg-warning/5 p-2.5 font-mono text-xs text-foreground">
            {revealed.secret}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void copySensitive(revealed.secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : `Copy ${label}`}
            </button>
            <button
              onClick={() => setRevealed(null)}
              className="flex items-center gap-1 font-mono text-[11px] text-meta hover:text-foreground"
            >
              <EyeOff className="h-3 w-3" /> Hide
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && reveal()}
            placeholder="Password to reveal passphrase"
            className="flex-1 rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
          />
          <button
            onClick={reveal}
            disabled={busy}
            className="flex items-center gap-1 rounded border border-primary px-2.5 py-1.5 font-mono text-xs text-primary hover:bg-primary/10 disabled:opacity-40"
          >
            <Eye className="h-3 w-3" /> Reveal
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        {burner.unlocked && (
          <button
            onClick={() => {
              burner.lock();
              toast.success("Wallet locked");
            }}
            className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Lock className="h-3 w-3" /> Lock
          </button>
        )}
        <button
          onClick={remove}
          className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-danger hover:text-danger"
        >
          <Trash2 className="h-3 w-3" /> Remove Wallet
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">{label}</div>
      <div className="font-mono text-xs">{children}</div>
    </div>
  );
}
