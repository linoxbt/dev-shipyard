// Reusable "back up your seed phrase" view shown right after a DevStation wallet
// is generated (Sui, Stacks). Displays the BIP-39 mnemonic as a numbered grid,
// blurred until revealed, with copy + a "I've backed it up" gate — the same
// discipline as the EVM GenerateWalletDialog's BackupView. The seed phrase is
// ALWAYS shown at generation time so the user can record it.

import { useState } from "react";
import { AlertTriangle, Copy, Check, Eye } from "lucide-react";
import { copySensitive } from "@/lib/clipboard";

export function SeedPhraseBackup({
  mnemonic,
  onDone,
  chainLabel,
}: {
  mnemonic: string;
  onDone: () => void;
  chainLabel: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const words = mnemonic.trim().split(/\s+/);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2.5 font-mono text-[11px] text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          This is your {chainLabel} recovery phrase. Write it down and store it offline — anyone with
          it controls this wallet. It is shown only once.
        </span>
      </div>
      <div className="relative rounded border border-border bg-background p-3">
        <div className={`grid grid-cols-3 gap-2 font-mono text-xs ${revealed ? "" : "blur-sm select-none"}`}>
          {words.map((w, i) => (
            <span key={i} className="text-foreground">
              <span className="mr-1 text-meta">{i + 1}.</span>
              {w}
            </span>
          ))}
        </div>
        {!revealed && (
          <button
            onClick={() => setRevealed(true)}
            className="absolute inset-0 flex items-center justify-center gap-1.5 font-mono text-xs text-primary"
          >
            <Eye className="h-3.5 w-3.5" /> Click to reveal
          </button>
        )}
      </div>
      <button
        onClick={() => {
          void copySensitive(mnemonic);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex items-center gap-1 font-mono text-[11px] text-meta hover:text-primary"
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy to clipboard"}
      </button>
      <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have
        safely backed up my seed phrase
      </label>
      <button
        disabled={!saved}
        onClick={onDone}
        className="w-full rounded bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
      >
        Continue
      </button>
    </div>
  );
}
