import { ShieldCheck, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useVerifyContract } from "@/hooks/useVerifyContract";

interface Props {
  chainId: number;
  address: `0x${string}`;
  contractName: string;
  sourceCode: string;
  compilerVersion?: string;
  optimization?: boolean;
  optimizationRuns?: number;
}

// Click-to-verify button with inline status, for places where a contract's
// source is known (e.g. a DevStation-deployed project).
export function VerifyButton({
  chainId,
  address,
  contractName,
  sourceCode,
  compilerVersion = "0.8.20",
  optimization = false,
  optimizationRuns = 200,
}: Props) {
  const { verify, state, message } = useVerifyContract();
  const busy = state === "submitting" || state === "pending";

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={() =>
          verify({
            chainId,
            address,
            contractName,
            sourceCode,
            compilerVersion,
            optimization,
            optimizationRuns,
          })
        }
        disabled={busy || state === "verified"}
        className="flex items-center justify-center gap-2 rounded border border-primary bg-primary/10 px-3 py-2 font-mono text-xs font-medium text-primary hover:bg-primary/20 disabled:opacity-60"
        title="Submit this contract's source to the QIE explorer for verification"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : state === "verified" ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : state === "failed" ? (
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        ) : (
          <ShieldCheck className="h-3.5 w-3.5" />
        )}
        {busy
          ? "Verifying…"
          : state === "verified"
            ? "Verified on Explorer"
            : "Verify on QIE Explorer"}
      </button>
      {message && state !== "verified" && (
        <span
          className={`font-mono text-[10px] ${state === "failed" ? "text-warning" : "text-meta"}`}
        >
          {message}
        </span>
      )}
    </div>
  );
}
