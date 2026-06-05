import { useState } from "react";
import { AlertTriangle, Copy, Check, Eye, KeyRound, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useConnect } from "wagmi";
import { useBurner } from "@/lib/burner/store";

type Mode = "menu" | "create" | "backup" | "unlock" | "import";

// Modal for the in-app generated ("burner") wallet: create a new password-
// encrypted wallet, unlock an existing one, or import a seed phrase. After a
// successful create/unlock it connects the burner wagmi connector.
export function GenerateWalletDialog({ onClose }: { onClose: () => void }) {
  const burner = useBurner();
  const { connect, connectors } = useConnect();
  const [mode, setMode] = useState<Mode>(burner.exists ? "unlock" : "menu");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [importPhrase, setImportPhrase] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [busy, setBusy] = useState(false);

  const connectBurner = () => {
    const c = connectors.find((x) => x.id === "devstation-burner");
    if (c) connect({ connector: c });
  };

  const handleCreate = async () => {
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const phrase = await burner.createWallet(password);
      setMnemonic(phrase);
      setMode("backup");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create wallet");
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setBusy(true);
    try {
      await burner.unlock(password);
      connectBurner();
      toast.success("Wallet unlocked");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    const words = importPhrase.trim().split(/\s+/);
    if (words.length !== 12 && words.length !== 24) {
      return toast.error("Seed phrase must be 12 or 24 words");
    }
    setBusy(true);
    try {
      await burner.importWallet(importPhrase, password);
      connectBurner();
      toast.success("Wallet imported");
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const finishBackup = () => {
    connectBurner();
    toast.success("Wallet ready");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded border border-border bg-surface p-6">
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-base font-bold text-foreground">DevStation Wallet</h2>
        </div>

        {mode === "menu" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Generate a self-custody dev wallet, encrypted with a password and stored only in this
              browser. Ideal for testnet.
            </p>
            <button
              onClick={() => setMode("create")}
              className="flex w-full items-center gap-2 rounded bg-primary px-3 py-2 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <KeyRound className="h-3.5 w-3.5" /> Generate New Wallet
            </button>
            <button
              onClick={() => setMode("import")}
              className="flex w-full items-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              Import Seed Phrase
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-3">
            <FieldLabel>Encryption Password</FieldLabel>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
            />
            <FieldLabel>Confirm Password</FieldLabel>
            <PasswordInput value={confirm} onChange={setConfirm} placeholder="Re-enter password" />
            <MainnetWarning />
            <DialogActions
              onCancel={() => setMode("menu")}
              onConfirm={handleCreate}
              confirmLabel={busy ? "Creating…" : "Create Wallet"}
              busy={busy}
            />
          </div>
        )}

        {mode === "backup" && <BackupView mnemonic={mnemonic} onDone={finishBackup} />}

        {mode === "unlock" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Unlock your DevStation wallet
              {burner.address ? ` (${burner.address.slice(0, 6)}…${burner.address.slice(-4)})` : ""}
              .
            </p>
            <FieldLabel>Password</FieldLabel>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="Wallet password"
              onEnter={handleUnlock}
            />
            <div className="flex items-center justify-between">
              <button
                onClick={() => setMode("menu")}
                className="font-mono text-[11px] text-meta hover:text-primary"
              >
                Use a different wallet
              </button>
            </div>
            <DialogActions
              onCancel={onClose}
              onConfirm={handleUnlock}
              confirmLabel={busy ? "Unlocking…" : "Unlock"}
              busy={busy}
            />
          </div>
        )}

        {mode === "import" && (
          <div className="space-y-3">
            <FieldLabel>Seed Phrase (12 or 24 words)</FieldLabel>
            <textarea
              value={importPhrase}
              onChange={(e) => setImportPhrase(e.target.value)}
              rows={3}
              placeholder="word1 word2 word3 …"
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
            <FieldLabel>Encryption Password</FieldLabel>
            <PasswordInput
              value={password}
              onChange={setPassword}
              placeholder="At least 8 characters"
            />
            <MainnetWarning />
            <DialogActions
              onCancel={() => setMode("menu")}
              onConfirm={handleImport}
              confirmLabel={busy ? "Importing…" : "Import Wallet"}
              busy={busy}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BackupView({ mnemonic, onDone }: { mnemonic: string; onDone: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2.5 font-mono text-[11px] text-warning">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Write this seed phrase down and store it offline. Anyone with it controls this wallet. It
          is shown only once.
        </span>
      </div>
      <div className="relative rounded border border-border bg-background p-3">
        <div
          className={`grid grid-cols-3 gap-2 font-mono text-xs ${revealed ? "" : "blur-sm select-none"}`}
        >
          {mnemonic.split(" ").map((w, i) => (
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
          navigator.clipboard.writeText(mnemonic);
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

function MainnetWarning() {
  return (
    <p className="text-[10px] text-meta">
      Browser-stored keys are convenient for testnet but riskier than a hardware wallet. Avoid
      keeping large mainnet balances here.
    </p>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-wider text-meta">{children}</div>;
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onEnter?: () => void;
}) {
  return (
    <input
      type="password"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      placeholder={placeholder}
      className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
    />
  );
}

function DialogActions({
  onCancel,
  onConfirm,
  confirmLabel,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy: boolean;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button
        onClick={onCancel}
        className="rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
      >
        Cancel
      </button>
      <button
        onClick={onConfirm}
        disabled={busy}
        className="rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
      >
        {confirmLabel}
      </button>
    </div>
  );
}
