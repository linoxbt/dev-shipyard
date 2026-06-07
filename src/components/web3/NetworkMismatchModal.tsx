import { AlertTriangle } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSwitchNetwork: () => void;
  targetNetwork: string;
  walletNetwork: string;
  switching?: boolean;
}

// Blocks a deploy/write when the wallet is on a different chain than the
// selected network. Does not auto-close — the user must switch or cancel.
export function NetworkMismatchModal({
  isOpen,
  onClose,
  onSwitchNetwork,
  targetNetwork,
  walletNetwork,
  switching,
}: Props) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface shadow-xl">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <h2 className="font-mono text-sm font-bold text-foreground">Network Mismatch</h2>
        </div>
        <div className="px-4 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
          You&apos;re trying to deploy to <span className="text-foreground">{targetNetwork}</span>{" "}
          but your wallet is connected to <span className="text-foreground">{walletNetwork}</span>.
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            disabled={switching}
            className="rounded border border-border px-3 py-1.5 font-mono text-xs text-meta hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onSwitchNetwork}
            disabled={switching}
            className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {switching ? "Switching…" : `Switch Wallet to ${targetNetwork}`}
          </button>
        </div>
      </div>
    </div>
  );
}
