import { useEffect, useState } from "react";
import { Wallet, Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { useConnect } from "wagmi";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";
import { GenerateWalletDialog } from "./GenerateWalletDialog";
import { GenerateSolanaDialog } from "@/components/solana/GenerateSolanaDialog";
import { GenerateStacksDialog } from "@/components/stacks/GenerateStacksDialog";
import { useActiveFamily } from "@/lib/active-network";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { ChainLogo } from "@/lib/chain-logos";

type Step = "evm" | "solana" | "stacks";

// Two-step connect flow: first pick the chain (EVM / Solana / Stacks), then pick
// a wallet detected for that chain. Connecting flips the app's active chain family
// so the whole app follows the wallet you chose.
export function ConnectModal({ onClose }: { onClose: () => void }) {
  const { connectors, connect, isPending } = useConnect();
  const setAppFamily = useActiveFamily((s) => s.setFamily);

  const solana = useWallet();
  const stacks = useStacksWallet();
  const [step, setStep] = useState<Step | null>(null);
  const [pendingSolana, setPendingSolana] = useState<string | null>(null);
  const [showGenerate, setShowGenerate] = useState<"evm" | "solana" | "stacks" | null>(null);

  useEffect(() => {
    if (!pendingSolana) return;
    if (solana.wallet?.adapter.name !== pendingSolana) return;
    if (solana.connected || solana.connecting) return;
    solana
      .connect()
      .then(() => {
        setAppFamily("solana");
        onClose();
      })
      .catch(() => {})
      .finally(() => setPendingSolana(null));
  }, [pendingSolana, solana, setAppFamily, onClose]);

  const seen = new Set<string>();
  const evm = connectors.filter((c) => {
    if (c.id === "devstation-burner") return false;
    const key = c.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const solWallets = solana.wallets.filter(
    (w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable,
  );

  if (showGenerate === "evm") return <GenerateWalletDialog onClose={onClose} />;
  if (showGenerate === "solana") return <GenerateSolanaDialog onClose={onClose} />;
  if (showGenerate === "stacks") return <GenerateStacksDialog onClose={onClose} />;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded border border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {step && (
              <button onClick={() => setStep(null)} className="text-meta hover:text-foreground" aria-label="Back">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <h2 className="font-mono text-base font-bold text-foreground">
              {step
                ? `Connect ${step === "evm" ? "EVM" : step === "solana" ? "Solana" : "Stacks"} Wallet`
                : "Connect a Wallet"}
            </h2>
          </div>
          <button onClick={onClose} className="text-meta hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step 1 — choose the chain */}
        {step === null && (
          <div className="space-y-2">
            <ChainChoice family="EVM" title="EVM" desc="QIE, BOT, Arc, GOAT — MetaMask, QIE Wallet…" onClick={() => setStep("evm")} />
            <ChainChoice family="Solana" title="Solana" desc="Phantom, Solflare, in-app burner" onClick={() => setStep("solana")} />
            <ChainChoice family="Stacks" title="Stacks" desc="DevStation wallet, Leather, Xverse" onClick={() => setStep("stacks")} />
          </div>
        )}

        {/* Step 2 — wallets for the chosen chain */}
        {step === "evm" && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {evm.length === 0 && (
              <Note>No EVM wallet detected. Install QIE Wallet / MetaMask, or generate one below.</Note>
            )}
            {evm.map((c) => (
              <WalletRow
                key={c.uid}
                icon={(c as { icon?: string }).icon}
                name={c.name}
                disabled={isPending}
                onClick={() =>
                  connect(
                    { connector: c },
                    { onSuccess: () => { setAppFamily("evm"); onClose(); } },
                  )
                }
              />
            ))}
            <GenerateRow label="Generate EVM Wallet" caption="Password-encrypted. Great for testnet." onClick={() => setShowGenerate("evm")} />
          </div>
        )}

        {step === "solana" && (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {solWallets.length === 0 && (
              <Note>No Solana wallet detected. Install Phantom / Solflare, or generate one below.</Note>
            )}
            {solWallets.map((w) => (
              <WalletRow
                key={w.adapter.name}
                icon={w.adapter.icon}
                name={w.adapter.name}
                disabled={!!pendingSolana}
                onClick={() => {
                  solana.select(w.adapter.name);
                  setPendingSolana(w.adapter.name);
                }}
              />
            ))}
            <GenerateRow label="Generate Solana Wallet" caption="Password-encrypted. Great for devnet." onClick={() => setShowGenerate("solana")} />
          </div>
        )}

        {step === "stacks" && (
          <div className="space-y-2">
            <GenerateRow
              label="Generate Stacks Wallet"
              caption="Seed-phrase wallet. Signs Clarity deploys directly."
              onClick={() => setShowGenerate("stacks")}
            />
            <WalletRow
              name="Leather / Xverse / Hiro"
              disabled={false}
              onClick={async () => {
                try {
                  await stacks.connect();
                  setAppFamily("stacks");
                  onClose();
                } catch {
                  /* user cancelled */
                }
              }}
            />
            <Note>Generate a DevStation wallet (shows a seed phrase), or open an installed Stacks wallet.</Note>
          </div>
        )}
      </div>
    </div>
  );
}

function ChainChoice({
  family,
  title,
  desc,
  onClick,
}: {
  family: string;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded border border-border bg-background px-3 py-3 text-left transition hover:border-primary/50"
    >
      <ChainLogo family={family} size={28} />
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-sm font-bold text-foreground">{title}</span>
        <span className="block truncate font-mono text-[10px] text-meta">{desc}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-meta" />
    </button>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-border bg-background p-3 font-mono text-[11px] text-meta">{children}</p>
  );
}

function WalletRow({
  icon,
  name,
  disabled,
  onClick,
}: {
  icon?: string;
  name: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-3 rounded border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/50 disabled:opacity-50"
    >
      {icon ? (
        <img src={icon} alt="" className="h-7 w-7 rounded" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-surface-2 text-muted-foreground">
          <Wallet className="h-4 w-4" />
        </span>
      )}
      <span className="font-mono text-xs font-medium text-foreground">{name}</span>
    </button>
  );
}

function GenerateRow({ label, caption, onClick }: { label: string; caption: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded border border-border bg-background px-3 py-2.5 text-left transition hover:border-primary/50"
    >
      <span className="flex h-7 w-7 items-center justify-center rounded bg-primary/15 text-primary">
        <Plus className="h-4 w-4" />
      </span>
      <span>
        <span className="block font-mono text-xs font-medium text-foreground">{label}</span>
        <span className="block font-mono text-[10px] text-meta">{caption}</span>
      </span>
    </button>
  );
}
