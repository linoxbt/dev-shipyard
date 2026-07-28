import { useState } from "react";
import { KeyRound, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useSolanaBurner } from "@/lib/solana/burner/store";
import { useActiveFamily } from "@/lib/active-network";
import { SeedPhraseBackup } from "@/components/shared/SeedPhraseBackup";

type Mode = "menu" | "create" | "unlock" | "import" | "backup";

// In-app generated Solana ("burner") wallet dialog — the Solana analog of
// GenerateWalletDialog. Create/unlock/import a password-encrypted keypair and
// make Solana the active family so the app follows.
export function GenerateSolanaDialog({ onClose }: { onClose: () => void }) {
  const burner = useSolanaBurner();
  const setFamily = useActiveFamily((s) => s.setFamily);
  const [mode, setMode] = useState<Mode>(burner.exists ? "unlock" : "menu");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [importSecret, setImportSecret] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const done = () => {
    setFamily("solana");
    onClose();
  };

  const handleCreate = async () => {
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords do not match");
    setBusy(true);
    try {
      const s = await burner.createWallet(password);
      setSecret(s);
      setMode("backup");
      // Deliberately NOT setFamily("solana") here — the sidebar's
      // FamilyWalletPanel switches which panel is mounted based on the
      // active family, and this dialog is rendered underneath whichever
      // panel opened it. Flipping family before the backup screen is
      // dismissed unmounts this whole dialog mid-render, so the seed phrase
      // never actually gets shown. done() (below) sets it once the user has
      // confirmed the backup.
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
      toast.success("Solana wallet unlocked");
      done();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unlock failed");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (!importSecret.trim()) return toast.error("Paste a base58 secret key");
    setBusy(true);
    try {
      await burner.importWallet(importSecret, password);
      toast.success("Solana wallet imported");
      done();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded border border-border bg-surface p-6">
        <div className="mb-4 flex items-center gap-2">
          <Wallet className="h-4 w-4 text-primary" />
          <h2 className="font-mono text-base font-bold text-foreground">
            Solana DevStation Wallet
          </h2>
        </div>

        {mode === "menu" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Generate a self-custody Solana dev wallet, encrypted with a password and stored only
              in this browser. Ideal for devnet.
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
              Import Secret Key
            </button>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-3">
            <Label>Encryption Password</Label>
            <Pw value={password} onChange={setPassword} placeholder="At least 8 characters" />
            <Label>Confirm Password</Label>
            <Pw value={confirm} onChange={setConfirm} placeholder="Re-enter password" />
            <Actions
              onCancel={() => setMode("menu")}
              onConfirm={handleCreate}
              label={busy ? "Creating…" : "Create Wallet"}
              busy={busy}
            />
          </div>
        )}

        {mode === "unlock" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Unlock your Solana wallet
              {burner.address ? ` (${burner.address.slice(0, 4)}…${burner.address.slice(-4)})` : ""}
              .
            </p>
            <Label>Password</Label>
            <Pw
              value={password}
              onChange={setPassword}
              placeholder="Wallet password"
              onEnter={handleUnlock}
            />
            <button
              onClick={() => setMode("menu")}
              className="font-mono text-[11px] text-meta hover:text-primary"
            >
              Use a different wallet
            </button>
            <Actions
              onCancel={onClose}
              onConfirm={handleUnlock}
              label={busy ? "Unlocking…" : "Unlock"}
              busy={busy}
            />
          </div>
        )}

        {mode === "import" && (
          <div className="space-y-3">
            <Label>Secret Key (base58)</Label>
            <textarea
              value={importSecret}
              onChange={(e) => setImportSecret(e.target.value)}
              rows={2}
              placeholder="base58 secret key…"
              className="w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
            />
            <Label>Encryption Password</Label>
            <Pw value={password} onChange={setPassword} placeholder="At least 8 characters" />
            <Actions
              onCancel={() => setMode("menu")}
              onConfirm={handleImport}
              label={busy ? "Importing…" : "Import Wallet"}
              busy={busy}
            />
          </div>
        )}

        {mode === "backup" && (
          <SeedPhraseBackup mnemonic={secret} onDone={done} chainLabel="Solana" />
        )}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-wider text-meta">{children}</div>;
}
function Pw({
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
function Actions({
  onCancel,
  onConfirm,
  label,
  busy,
}: {
  onCancel: () => void;
  onConfirm: () => void;
  label: string;
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
        {label}
      </button>
    </div>
  );
}
