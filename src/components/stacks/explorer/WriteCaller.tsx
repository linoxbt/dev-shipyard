// Public (write) function caller — for a deployed contract, lists its public
// functions and lets the user sign a contract-call with the wallet. Clarity has
// no deploy-time constructor arguments; the equivalent of "initialize" is
// calling a public function after deploy, which this panel does.

import { useState } from "react";
import { Zap, Loader2, ChevronRight, ExternalLink } from "lucide-react";
import { argToHex } from "@/lib/stacks/clarity-args";
import { useStacksWallet } from "@/hooks/useStacksWallet";
import { stacksExplorerLink, type StacksNetworkId } from "@/lib/stacks/chains";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Fn {
  name: string;
  access: string;
  args: Array<{ name: string; type: string }>;
  outputs: string;
}

export function WriteCaller({ network, contractId, fns }: { network: StacksNetworkId; contractId: string; fns: Fn[] }) {
  const writeFns = fns.filter((f) => f.access === "public");
  if (writeFns.length === 0) return null;
  return (
    <div className="rounded border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 font-mono text-xs font-bold text-foreground">
        <Zap className="h-3.5 w-3.5 text-warning" /> Public functions — call &amp; sign ({writeFns.length})
      </div>
      <div className="divide-y divide-border">
        {writeFns.map((f) => (
          <FnCall key={f.name} network={network} contractId={contractId} fn={f} />
        ))}
      </div>
      <div className="border-t border-border px-4 py-2 font-mono text-[10px] text-meta">
        Clarity has no deploy-time constructor arguments — initialize a contract by calling a public
        function here (signed by your wallet).
      </div>
    </div>
  );
}

function FnCall({ network, contractId, fn }: { network: StacksNetworkId; contractId: string; fn: Fn }) {
  const wallet = useStacksWallet();
  const [open, setOpen] = useState(false);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [txid, setTxid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async () => {
    if (!wallet.connected) return toast.error("Connect a Stacks wallet first.");
    setBusy(true);
    setTxid(null);
    try {
      const argsHex = fn.args.map((a) => argToHex(a.type, args[a.name] ?? ""));
      const id = await wallet.callContract({ contract: contractId, functionName: fn.name, functionArgs: argsHex });
      setTxid(id);
      toast.success(`${fn.name} submitted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Call failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 py-2 font-mono text-[11px]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 text-left">
        <ChevronRight className={cn("h-3 w-3 text-meta transition", open && "rotate-90")} />
        <span className="font-bold text-warning">{fn.name}</span>
        <span className="text-meta">→ {fn.outputs}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-4">
          {fn.args.map((a) => (
            <label key={a.name} className="block">
              <span className="text-[10px] text-meta">{a.name}: {a.type}</span>
              <input
                value={args[a.name] ?? ""}
                onChange={(e) => setArgs((s) => ({ ...s, [a.name]: e.target.value }))}
                placeholder={a.type}
                className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 text-[11px] text-foreground outline-none focus:border-primary"
              />
            </label>
          ))}
          <button onClick={call} disabled={busy} className="inline-flex items-center gap-1.5 rounded bg-warning/90 px-2.5 py-1 text-[11px] text-background hover:bg-warning disabled:opacity-50">
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />} Call &amp; sign
          </button>
          {txid && (
            <a href={stacksExplorerLink(network, "txid", txid)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 truncate text-primary hover:underline">
              {txid} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
