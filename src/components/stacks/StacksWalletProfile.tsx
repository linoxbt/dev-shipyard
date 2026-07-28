// Settings "Wallet & Profile" panel for the Stacks family — connection state and
// management (reveal the seed phrase behind the password, lock, remove) for the
// in-app generated Stacks ("DevStation") wallet. Falls back to the connect panel
// (Leather / Xverse / generate) when nothing is connected.

import { useState } from "react";
import { Eye, EyeOff, Copy, Check, Lock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StacksWalletPanel } from "@/components/stacks/StacksWalletPanel";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { useStacksBurner } from "@/lib/stacks/burner/store";
import { useStacksPref } from "@/lib/stacks/active-stacks";
import { stacksChain } from "@/lib/stacks/chains";
import { copySensitive } from "@/lib/clipboard";

export function StacksWalletProfile() {
  const wallet = useStacksWallet();
  const burner = useStacksBurner();
  const network = useStacksPref((s) => s.network);

  return (
    <div className="space-y-4">
      {wallet.connected && wallet.address ? (
        <div className="space-y-3">
          <Row label="Status">
            <span className="flex items-center gap-1.5 text-success">
              <span className="h-2 w-2 rounded-full bg-success" /> Connected
              <span className="text-meta">· {wallet.source === "burner" ? "DevStation wallet" : "Leather / Xverse"}</span>
            </span>
          </Row>
          <Row label="Address"><span className="break-all text-foreground">{wallet.address}</span></Row>
          <Row label="Network"><span className="text-foreground">{stacksChain(network).name}</span></Row>
        </div>
      ) : (
        <StacksWalletPanel />
      )}

      {burner.exists && (
        <div className="rounded border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-meta">DevStation Stacks Wallet</span>
            {burner.unlocked && <span className="font-mono text-[10px] text-success">unlocked</span>}
          </div>
          <StacksBurnerControls />
        </div>
      )}
    </div>
  );
}

function StacksBurnerControls() {
  const burner = useStacksBurner();
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    if (!password) return toast.error("Enter your password to reveal the seed phrase");
    setBusy(true);
    try {
      setSecret(await burner.revealMnemonic(password));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!confirm("Remove this Stacks wallet? Back up the seed phrase first — this cannot be undone.")) return;
    burner.remove();
    setSecret(null);
    setPassword("");
    toast.success("Stacks wallet removed from this browser");
  };

  return (
    <div className="space-y-2">
      {secret ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 rounded border border-warning/40 bg-warning/5 p-2.5 font-mono text-xs text-foreground">
            {secret.split(/\s+/).map((w, i) => (
              <span key={i}><span className="mr-1 text-meta">{i + 1}.</span>{w}</span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                void copySensitive(secret);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy seed phrase"}
            </button>
            <button onClick={() => setSecret(null)} className="flex items-center gap-1 font-mono text-[11px] text-meta hover:text-foreground">
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
            placeholder="Password to reveal seed phrase"
            className="flex-1 rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
          />
          <button onClick={reveal} disabled={busy} className="flex items-center gap-1 rounded border border-primary px-2.5 py-1.5 font-mono text-xs text-primary hover:bg-primary/10 disabled:opacity-40">
            <Eye className="h-3 w-3" /> Reveal
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        {burner.unlocked && (
          <button onClick={() => { burner.lock(); toast.success("Wallet locked"); }} className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary">
            <Lock className="h-3 w-3" /> Lock
          </button>
        )}
        <button onClick={remove} className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-danger hover:text-danger">
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
