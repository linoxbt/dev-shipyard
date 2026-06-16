import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, AlertTriangle, ShieldCheck, Compass } from "lucide-react";
import { compile, SOLC_VERSIONS, DEFAULT_SOLC_VERSION } from "@/lib/compiler";
import { useVerifyContract } from "@/hooks/useVerifyContract";
import { slugForChainId } from "@/lib/explorer/network";

interface Props {
  chainId: number;
  address: `0x${string}`;
  /** Prefill the compiler version (e.g. the project's stored version). */
  defaultCompilerVersion?: string;
}

// Manual verification for older deployments where we never stored the source.
// The user pastes the exact Solidity they deployed; we compile it in-browser
// (resolving OpenZeppelin imports just like the deploy flow) and verify via the
// robust standard-input path. The compiler version (and optimizer settings, which
// DevStation always leaves off) must match the original deploy for the bytecode
// to match — we default the version and let the user change it.
export function ManualVerify({ chainId, address, defaultCompilerVersion }: Props) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [version, setVersion] = useState(
    defaultCompilerVersion && SOLC_VERSIONS.includes(defaultCompilerVersion as never)
      ? defaultCompilerVersion
      : DEFAULT_SOLC_VERSION,
  );
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState("");
  const { verify, state, message } = useVerifyContract();

  const busy = compiling || state === "submitting" || state === "pending";
  const verified = state === "verified";

  const run = async () => {
    setError("");
    const src = source.trim();
    if (!src) {
      setError("Paste your contract source first.");
      return;
    }
    setCompiling(true);
    try {
      const out = await compile({
        sources: { "Contract.sol": src },
        version,
        mainFile: "Contract.sol",
      });
      if (out.status === "error") {
        setError(out.errors[0]?.formattedMessage || "Compilation failed.");
        return;
      }
      // Pick the deployable contract: the one with the most creation bytecode
      // (skips interfaces/libraries with empty bytecode).
      const entries = Object.entries(out.contracts).filter(([, c]) => c.bytecode.length > 2);
      if (entries.length === 0) {
        setError("No deployable contract found in that source.");
        return;
      }
      entries.sort((a, b) => b[1].bytecode.length - a[1].bytecode.length);
      const [name, picked] = entries[0];
      // Constructor args are unknown here → let the explorer autodetect them
      // from the creation transaction (constructorArgs omitted).
      await verify({
        chainId,
        address,
        contractName: name,
        sourceCode: src,
        compilerVersion: version,
        standardJsonInput: out.standardJsonInput,
        qualifiedContractName: picked.qualifiedName,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed.");
    } finally {
      setCompiling(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center justify-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
        title="Verify by pasting the contract source you deployed"
      >
        <ShieldCheck className="h-3.5 w-3.5" /> Verify with source
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded border border-border bg-background p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-wider text-meta">
          Verify with source
        </span>
        <select
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-foreground"
          title="solc version used to deploy"
        >
          {SOLC_VERSIONS.map((v) => (
            <option key={v} value={v}>
              solc {v}
            </option>
          ))}
        </select>
      </div>
      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        placeholder="// Paste the exact Solidity source you deployed (imports like @openzeppelin/... are resolved automatically)"
        spellCheck={false}
        className="h-40 w-full resize-y rounded border border-border bg-surface p-2 font-mono text-[11px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
      />
      <p className="font-mono text-[10px] text-meta">
        Use the same solc version you deployed with. DevStation deploys with the optimizer off (200
        runs).
      </p>

      {(message || error) && (
        <div className="flex items-center gap-2 font-mono text-[11px]">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-info" />}
          {verified && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
          {(error || state === "failed") && <AlertTriangle className="h-3.5 w-3.5 text-warning" />}
          <span
            className={
              verified ? "text-success" : error || state === "failed" ? "text-warning" : "text-meta"
            }
          >
            {error || message}
          </span>
        </div>
      )}

      <div className="flex items-center gap-3">
        {!verified && (
          <button
            onClick={run}
            disabled={busy}
            className="rounded border border-primary bg-primary/10 px-3 py-1.5 font-mono text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
          >
            {busy ? "Verifying…" : "Compile & Verify"}
          </button>
        )}
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network: slugForChainId(chainId), hash: address }}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-meta hover:text-primary"
        >
          View on explorer <Compass className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
