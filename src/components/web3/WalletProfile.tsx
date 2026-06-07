import { useState } from "react";
import { Copy, Check, Eye, EyeOff, Lock, Trash2, Wallet, Fuel } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useBalance, useConnect } from "wagmi";
import { useBurner } from "@/lib/burner/store";
import { chainConfig, gasLink } from "@/lib/chains";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useQusdcBalance } from "@/hooks/useQusdc";
import { AddressChip } from "@/components/shared/AddressChip";
import { GenerateWalletDialog } from "./GenerateWalletDialog";
import { ConnectModal } from "./ConnectModal";

const LOW_GAS_THRESHOLD = 0.01;

// Profile/settings wallet panel: connection + live balances for any wallet, plus
// management (reveal seed behind password, lock, remove) for the in-app
// generated wallet.
export function WalletProfile() {
  const { address, isConnected, connector } = useAccount();
  const { chainId } = useActiveChain();
  const { data: balance } = useBalance({
    address,
    chainId,
    query: { enabled: isConnected, refetchInterval: 30_000 },
  });
  const qusdc = useQusdcBalance(address, chainId);
  const burner = useBurner();
  const { connect, connectors } = useConnect();
  const [showGenerate, setShowGenerate] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const cfg = chainConfig(chainId);
  const isBurner = connector?.id === "devstation-burner";
  const lowGas = balance ? Number(balance.formatted) < LOW_GAS_THRESHOLD : false;
  const gas = gasLink(chainId);

  const connectBurner = () => {
    const c = connectors.find((x) => x.id === "devstation-burner");
    if (c) connect({ connector: c });
  };

  return (
    <div className="space-y-4">
      {/* Connection state */}
      {isConnected && address ? (
        <div className="space-y-3">
          <Row label="Status">
            <span className="flex items-center gap-1.5 text-success">
              <span className="h-2 w-2 rounded-full bg-success" /> Connected
              {connector?.name ? <span className="text-meta">· {connector.name}</span> : null}
            </span>
          </Row>
          <Row label="Address">
            <AddressChip address={address} showLabel={false} full />
          </Row>
          <Row label="QIE Balance">
            <span className="text-foreground">
              {balance ? `${Number(balance.formatted).toFixed(6)} ${balance.symbol}` : "…"}
            </span>
          </Row>
          {qusdc && (
            <Row label="QUSDC Balance">
              <span className="text-foreground">
                {qusdc.formatted} <span className="text-meta">QUSDC</span>
              </span>
            </Row>
          )}
          <Row label="Network">
            <span className="text-foreground">
              {cfg.name} <span className="text-meta">· Chain {chainId}</span>
            </span>
          </Row>
          <div className="flex flex-wrap gap-3">
            <a
              href={gas.url}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1 font-mono text-xs hover:underline ${lowGas ? "text-warning" : "text-primary"}`}
            >
              <Fuel className="h-3 w-3" /> {gas.label}
            </a>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">No wallet connected.</p>
          <div className="flex gap-2">
            <button
              onClick={() => setShowConnect(true)}
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Wallet className="h-3.5 w-3.5" /> Connect
            </button>
            <button
              onClick={() => (burner.exists ? connectBurner() : setShowGenerate(true))}
              className="rounded border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              {burner.exists ? "Unlock DevStation Wallet" : "Generate Wallet"}
            </button>
          </div>
        </div>
      )}

      {/* Generated-wallet management */}
      {burner.exists && (
        <div className="rounded border border-border bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-meta">
              DevStation Generated Wallet
            </span>
            {isBurner && burner.unlocked && (
              <span className="font-mono text-[10px] text-success">unlocked</span>
            )}
          </div>
          <BurnerControls />
        </div>
      )}

      {showGenerate && <GenerateWalletDialog onClose={() => setShowGenerate(false)} />}
      {showConnect && <ConnectModal onClose={() => setShowConnect(false)} />}
    </div>
  );
}

function BurnerControls() {
  const burner = useBurner();
  const [password, setPassword] = useState("");
  const [seed, setSeed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const reveal = async () => {
    if (!password) return toast.error("Enter your password to reveal the seed");
    setBusy(true);
    try {
      const m = await burner.revealMnemonic(password);
      setSeed(m);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reveal failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (
      !confirm(
        "Remove this wallet? Make sure you have backed up the seed phrase — this cannot be undone.",
      )
    ) {
      return;
    }
    burner.remove();
    setSeed(null);
    setPassword("");
    toast.success("Wallet removed from this browser");
  };

  return (
    <div className="space-y-2">
      {seed ? (
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2 rounded border border-warning/40 bg-warning/5 p-2.5 font-mono text-xs">
            {seed.split(" ").map((w, i) => (
              <span key={i} className="text-foreground">
                <span className="mr-1 text-meta">{i + 1}.</span>
                {w}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                navigator.clipboard.writeText(seed);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
            >
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy seed"}
            </button>
            <button
              onClick={() => setSeed(null)}
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
            placeholder="Password to reveal seed"
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
