import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, Loader2, ShieldCheck, AlertTriangle, Compass } from "lucide-react";
import { useVerifyContract } from "@/hooks/useVerifyContract";
import { slugForChainId } from "@/lib/explorer/network";

interface Props {
  chainId: number;
  address: `0x${string}`;
  contractName: string;
  sourceCode: string;
  compilerVersion: string; // short, e.g. "0.8.20"
  optimization?: boolean;
  optimizationRuns?: number;
  /** Auto-submit for verification as soon as the card mounts. */
  auto?: boolean;
}

// Submits a freshly deployed contract to the QIE explorer for source
// verification and shows live status. Self-contained so the deploy flow stays
// untouched.
export function VerifyCard({
  chainId,
  address,
  contractName,
  sourceCode,
  compilerVersion,
  optimization,
  optimizationRuns,
  auto = true,
}: Props) {
  const { verify, state, message } = useVerifyContract();
  const started = useRef(false);

  const run = () =>
    verify({
      chainId,
      address,
      contractName,
      sourceCode,
      compilerVersion,
      optimization,
      optimizationRuns,
    });

  useEffect(() => {
    if (auto && !started.current) {
      started.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = state === "submitting" || state === "pending";
  const verified = state === "verified";
  const failed = state === "failed";

  return (
    <div className="rounded border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Source Verification
        </h3>
      </div>

      <div className="flex items-center gap-2 rounded border border-border bg-background p-3 font-mono text-xs">
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-info" />}
        {verified && <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
        {failed && <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />}
        {state === "idle" && <ShieldCheck className="h-4 w-4 shrink-0 text-meta" />}
        <span
          className={verified ? "text-success" : failed ? "text-warning" : "text-muted-foreground"}
        >
          {message || "Ready to verify on the QIE explorer."}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        {(failed || state === "idle") && (
          <button
            onClick={run}
            className="rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10"
          >
            {failed ? "Retry verification" : "Verify on QIE Explorer"}
          </button>
        )}
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network: slugForChainId(chainId), hash: address }}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-meta hover:text-primary"
        >
          View the contract on the DevStation explorer <Compass className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
