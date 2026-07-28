// Read-only Clarity function sandbox — for a deployed contract, lists its
// read-only functions and lets the user call them live against the Hiro node
// (typed args → hex → call-read → decoded Clarity result). The Stacks analog of
// the Solana IDL interact panel.

import { useState } from "react";
import { Play, Loader2, ChevronRight } from "lucide-react";
import { stacksCallReadOnly } from "@/lib/api/stacks-explorer.functions";
import { argToHex, decodeClarityHex } from "@/lib/stacks/clarity-args";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import type { StacksNetworkId } from "@/lib/stacks/chains";
import { cn } from "@/lib/utils";

interface Fn {
  name: string;
  access: string;
  args: Array<{ name: string; type: string }>;
  outputs: string;
}

export function ReadOnlyCaller({ network, contractId, fns }: { network: StacksNetworkId; contractId: string; fns: Fn[] }) {
  const wallet = useStacksWallet();
  const readFns = fns.filter((f) => f.access === "read_only");
  if (readFns.length === 0) return null;
  const sender = wallet.address || contractId.split(".")[0];

  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Play className="h-3.5 w-3.5 text-primary" /> Read-only functions ({readFns.length})
      </div>
      <div className="divide-y divide-border">
        {readFns.map((f) => (
          <FnCall key={f.name} network={network} contractId={contractId} fn={f} sender={sender} />
        ))}
      </div>
    </div>
  );
}

function FnCall({ network, contractId, fn, sender }: { network: StacksNetworkId; contractId: string; fn: Fn; sender: string }) {
  const [open, setOpen] = useState(false);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const dot = contractId.indexOf(".");
      const addr = contractId.slice(0, dot);
      const name = contractId.slice(dot + 1);
      const argsHex = fn.args.map((a) => argToHex(a.type, args[a.name] ?? ""));
      const res = await stacksCallReadOnly({
        data: { network, contractAddress: addr, contractName: name, functionName: fn.name, sender, args: argsHex },
      });
      if (res.ok) setResult(decodeClarityHex(res.resultHex));
      else setError(res.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Call failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-2 font-mono text-[11px]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-left">
        <ChevronRight className={cn("h-3 w-3 text-meta transition", open && "rotate-90")} />
        <span className="font-bold text-primary">{fn.name}</span>
        <span className="text-meta">→ {fn.outputs}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-4">
          {fn.args.map((a) => (
            <label key={a.name} className="block">
              <span className="text-[10px] text-meta">
                {a.name}: {a.type}
              </span>
              <input
                value={args[a.name] ?? ""}
                onChange={(e) => setArgs((s) => ({ ...s, [a.name]: e.target.value }))}
                placeholder={a.type}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary"
              />
            </label>
          ))}
          <button
            onClick={call}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Call
          </button>
          {result !== null && (
            <div className="rounded border border-success/40 bg-success/10 p-2">
              <span className="text-[10px] text-meta">result</span>
              <div className="break-all text-success">{result}</div>
            </div>
          )}
          {error && <div className="rounded border border-danger/40 bg-danger/10 p-2 text-danger">{error}</div>}
        </div>
      )}
    </div>
  );
}
