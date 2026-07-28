// Solana-Playground-style "Initialize / Interact" panel. Given a deployed
// program's IDL, it lists the program's instructions (initialize, etc.) and lets
// the user fill args + accounts and invoke them — signed by the active Solana
// wallet via Anchor. Anchor is imported dynamically so it never runs during SSR.

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PublicKey, Keypair, SystemProgram, type Transaction } from "@solana/web3.js";
import { ChevronRight, Play, Loader2, KeyRound, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { cn } from "@/lib/utils";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface IdlAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
  isMut?: boolean;
  isSigner?: boolean;
  address?: string;
}
interface IdlArg {
  name: string;
  type: any;
}
interface IdlInstruction {
  name: string;
  args?: IdlArg[];
  accounts?: IdlAccount[];
}
interface Idl {
  address?: string;
  instructions?: IdlInstruction[];
}

function isSigner(a: IdlAccount) {
  return !!(a.signer ?? a.isSigner);
}
function isWritable(a: IdlAccount) {
  return !!(a.writable ?? a.isMut);
}

// Best-effort account auto-fill by conventional name.
function autofill(name: string, wallet: string | null): string {
  const n = name.toLowerCase();
  if (n.includes("system")) return SystemProgram.programId.toBase58();
  if (/(authority|payer|user|signer|owner|wallet|admin|initializer|fee_?payer)/.test(n)) {
    return wallet ?? "";
  }
  return "";
}

function typeLabel(t: any): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") return Object.keys(t)[0] ?? "arg";
  return "arg";
}

function coerceArg(t: any, raw: string, BN: any): any {
  const label = typeLabel(t);
  if (label === "bool") return raw === "true" || raw === "1";
  if (/^(u|i)(64|128)$/.test(label)) return new BN(raw || "0");
  if (/^(u|i)(8|16|32)$/.test(label)) return Number(raw || 0);
  if (label === "pubkey" || label === "publicKey") return new PublicKey(raw);
  if (label === "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function ProgramInteract({ programId, idl }: { programId: string; idl: unknown }) {
  const wallet = useSolanaWallet();
  const parsed = (idl ?? null) as Idl | null;
  const instructions = parsed?.instructions ?? [];

  if (!parsed || instructions.length === 0) {
    return (
      <div className="rounded border border-border bg-surface-2 p-3 font-mono text-[11px] text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-bold text-foreground">
          <Wand2 className="h-3.5 w-3.5 text-primary" /> Initialize &amp; Interact
        </div>
        No IDL was returned for this program, so its instructions can&apos;t be introspected. Deploy
        an Anchor program via the build service to enable initialization here.
      </div>
    );
  }

  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 font-mono text-xs font-bold text-foreground">
        <Wand2 className="h-3.5 w-3.5 text-primary" /> Initialize &amp; Interact
      </div>
      <div className="divide-y divide-border">
        {instructions.map((ix) => (
          <InstructionForm
            key={ix.name}
            ix={ix}
            programId={programId}
            idl={parsed}
            wallet={wallet}
          />
        ))}
      </div>
    </div>
  );
}

function InstructionForm({
  ix,
  programId,
  idl,
  wallet,
}: {
  ix: IdlInstruction;
  programId: string;
  idl: Idl;
  wallet: ReturnType<typeof useSolanaWallet>;
}) {
  const [open, setOpen] = useState(ix.name.toLowerCase().includes("init"));
  const [args, setArgs] = useState<Record<string, string>>({});
  const [accts, setAccts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const a of ix.accounts ?? []) init[a.name] = autofill(a.name, wallet.address);
    return init;
  });
  // Accounts the user chose to satisfy with a freshly generated keypair.
  const [gen, setGen] = useState<Record<string, Keypair | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState<string | null>(null);

  const newSignerCandidates = useMemo(
    () => (ix.accounts ?? []).filter((a) => isSigner(a) && isWritable(a)),
    [ix.accounts],
  );

  const invoke = async () => {
    if (!wallet.connected || !wallet.publicKey) {
      toast.error("Connect or unlock a Solana wallet first.");
      return;
    }
    setBusy(true);
    setSig(null);
    try {
      const anchor: any = await import("@coral-xyz/anchor");
      const provider = new anchor.AnchorProvider(
        wallet.connection,
        {
          publicKey: wallet.publicKey,
          signTransaction: (tx: Transaction) => wallet.signTransaction(tx),
          signAllTransactions: (txs: Transaction[]) => wallet.signAllTransactions(txs),
        },
        { commitment: "confirmed" },
      );
      // Override the IDL's address so calls hit the freshly deployed program.
      const fullIdl = { ...(idl as any), address: programId };
      const program = new anchor.Program(fullIdl, provider);

      const argValues = (ix.args ?? []).map((a) =>
        coerceArg(a.type, args[a.name] ?? "", anchor.BN),
      );

      const accountMap: Record<string, PublicKey> = {};
      const signers: Keypair[] = [];
      for (const a of ix.accounts ?? []) {
        const kp = gen[a.name];
        if (kp) {
          accountMap[a.name] = kp.publicKey;
          signers.push(kp);
          continue;
        }
        const v = (accts[a.name] ?? "").trim();
        if (!v) throw new Error(`Account "${a.name}" is required.`);
        accountMap[a.name] = new PublicKey(v);
      }

      const signature: string = await program.methods[ix.name](...argValues)
        .accounts(accountMap)
        .signers(signers)
        .rpc();
      setSig(signature);
      toast.success(`${ix.name} succeeded`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `${ix.name} failed`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 font-mono text-xs text-foreground"
      >
        <ChevronRight className={cn("h-3 w-3 text-meta transition", open && "rotate-90")} />
        <span className="font-bold text-primary">{ix.name}</span>
        <span className="text-meta">
          ({(ix.args ?? []).length} args, {(ix.accounts ?? []).length} accounts)
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-4">
          {(ix.args ?? []).map((a) => (
            <label key={a.name} className="block">
              <span className="font-mono text-[10px] text-meta">
                {a.name}: {typeLabel(a.type)}
              </span>
              <input
                value={args[a.name] ?? ""}
                onChange={(e) => setArgs((s) => ({ ...s, [a.name]: e.target.value }))}
                placeholder={typeLabel(a.type)}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary"
              />
            </label>
          ))}

          {(ix.accounts ?? []).map((a) => {
            const canGen = newSignerCandidates.includes(a);
            const generated = gen[a.name];
            return (
              <div key={a.name}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-meta">
                    {a.name}
                    {isSigner(a) && <span className="text-warning"> · signer</span>}
                    {isWritable(a) && <span className="text-info"> · mut</span>}
                  </span>
                  {canGen && (
                    <button
                      onClick={() =>
                        setGen((s) => ({
                          ...s,
                          [a.name]: s[a.name] ? undefined : Keypair.generate(),
                        }))
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-1 py-0.5 font-mono text-[9px]",
                        generated
                          ? "border-primary text-primary"
                          : "border-border text-meta hover:text-foreground",
                      )}
                      title="Use a freshly generated keypair for this account"
                    >
                      <KeyRound className="h-2.5 w-2.5" /> {generated ? "generated" : "new keypair"}
                    </button>
                  )}
                </div>
                <input
                  value={generated ? generated.publicKey.toBase58() : (accts[a.name] ?? "")}
                  onChange={(e) => setAccts((s) => ({ ...s, [a.name]: e.target.value }))}
                  disabled={!!generated}
                  placeholder="account address"
                  className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground outline-none focus:border-primary disabled:opacity-60"
                />
              </div>
            );
          })}

          <button
            onClick={invoke}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {busy ? "Sending…" : `Run ${ix.name}`}
          </button>

          {sig && (
            <Link
              to="/explorer/$network/tx/$hash"
              params={{ network: wallet.cluster, hash: sig }}
              className="truncate font-mono text-[10px] text-primary hover:underline"
            >
              {sig}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
