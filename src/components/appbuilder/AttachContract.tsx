import { useCallback, useState } from "react";
import { Link2, Loader2, X } from "lucide-react";
import { storage } from "@/lib/storage";
import { fromPasted, resolveAbi, type ResolvedAbi } from "@/lib/appgen/abi-source";

// Attaching a contract is optional and out of the way.
//
// The chat panel stays a chat panel: one box, one send button. Everything to
// do with picking a contract lives behind this control, because most ideas do
// not start from a deployed address, and when one does, it is a detail of the
// build, not a precondition for starting.

interface Props {
  chainId: number;
  attached: ResolvedAbi | null;
  onAttach: (value: ResolvedAbi | null) => void;
}

export function AttachContract({ chainId, attached, onAttach }: Props) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [abiJson, setAbiJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deployed = storage
    .loadProjects()
    .filter((p) => p.address && Array.isArray(p.abi) && p.abi.length > 0)
    .sort((a, b) => (b.deployedAt ?? 0) - (a.deployedAt ?? 0))
    .slice(0, 8);

  const attach = useCallback(
    async (addr: string) => {
      setBusy(true);
      setError(null);
      try {
        const result = abiJson.trim()
          ? fromPasted(addr.trim(), chainId, abiJson)
          : await resolveAbi(addr.trim(), chainId);
        if (!result.ok) {
          setError(result.message);
          return;
        }
        onAttach(result.value);
        setOpen(false);
        setAbiJson("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not read that contract.");
      } finally {
        setBusy(false);
      }
    },
    [abiJson, chainId, onAttach],
  );

  if (attached) {
    return (
      <span className="inline-flex items-center gap-1 rounded border border-info/40 bg-info/10 px-1.5 py-0.5 font-mono text-[10px] text-info">
        <Link2 className="h-2.5 w-2.5" />
        {attached.name ?? "contract"}
        <button
          onClick={() => onAttach(null)}
          title="Detach"
          className="ml-0.5 hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 font-mono text-[10px] text-meta transition hover:text-foreground"
      >
        <Link2 className="h-3 w-3" /> Attach contract
      </button>

      {open && (
        <div className="absolute right-0 top-6 z-50 w-72 space-y-2 rounded border border-border bg-surface p-2 shadow-lg">
          <p className="font-mono text-[10px] text-meta">
            Optional. Attach a contract and the app is wired to it: address, chain and ABI baked in.
          </p>

          {deployed.length > 0 && (
            <div className="max-h-32 space-y-0.5 overflow-y-auto">
              {deployed.map((p) => (
                <button
                  key={p.txHash}
                  onClick={() => void attach(p.address)}
                  className="w-full truncate rounded border border-border px-1.5 py-1 text-left font-mono text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
                >
                  {p.name || p.templateName || "Contract"} · {p.address.slice(0, 10)}…
                </button>
              ))}
            </div>
          )}

          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="0x… any verified address"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-foreground focus:border-primary focus:outline-none"
          />
          <textarea
            value={abiJson}
            onChange={(e) => setAbiJson(e.target.value)}
            rows={3}
            placeholder="ABI JSON: only needed if it is not verified"
            className="w-full resize-y rounded border border-border bg-background px-2 py-1 font-mono text-[10px] text-foreground focus:border-primary focus:outline-none"
          />
          {error && <p className="font-mono text-[10px] text-danger">{error}</p>}
          <button
            onClick={() => void attach(address)}
            disabled={busy || !address.trim()}
            className="inline-flex w-full items-center justify-center gap-1 rounded bg-primary px-2 py-1 font-mono text-[10px] font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {busy ? "Reading…" : "Attach"}
          </button>
        </div>
      )}
    </div>
  );
}
