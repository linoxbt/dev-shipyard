import { useCallback, useState } from "react";
import { submitVerification, getVerificationStatus } from "@/lib/api/verify.functions";

export type VerifyState = "idle" | "submitting" | "pending" | "verified" | "failed";

export interface VerifyParams {
  chainId: number;
  address: `0x${string}`;
  contractName: string;
  sourceCode: string;
  compilerVersion: string; // short, e.g. "0.8.20"
  optimization?: boolean;
  optimizationRuns?: number;
  licenseType?: string;
}

const POLL_MS = 4000;
const MAX_POLLS = 30; // ~2 minutes

// Submit a contract to the QIE explorer for source verification, then poll until
// it reports verified (or times out). Stateless across contracts — pass the
// target each call; the returned `state`/`message` track the latest run.
export function useVerifyContract() {
  const [state, setState] = useState<VerifyState>("idle");
  const [message, setMessage] = useState<string>("");

  const verify = useCallback(async (p: VerifyParams): Promise<boolean> => {
    setState("submitting");
    setMessage("Submitting source to the QIE explorer…");

    // Already verified? Skip submission.
    const pre = await getVerificationStatus({ data: { chainId: p.chainId, address: p.address } });
    if (pre.verified) {
      setState("verified");
      setMessage("Already verified on the QIE explorer.");
      return true;
    }

    const res = await submitVerification({
      data: {
        chainId: p.chainId,
        address: p.address,
        contractName: p.contractName,
        sourceCode: p.sourceCode,
        compilerVersion: p.compilerVersion,
        optimization: p.optimization ?? false,
        optimizationRuns: p.optimizationRuns ?? 200,
        licenseType: p.licenseType ?? "mit",
      },
    });
    if (!res.ok) {
      setState("failed");
      setMessage(res.message);
      return false;
    }

    setState("pending");
    setMessage("Verification submitted — waiting for the explorer to confirm…");

    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      const s = await getVerificationStatus({
        data: { chainId: p.chainId, address: p.address },
      });
      if (s.verified) {
        setState("verified");
        setMessage("Contract verified on the QIE explorer.");
        return true;
      }
    }
    setState("failed");
    setMessage("Still pending — the explorer may finish shortly. Check the explorer page.");
    return false;
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setMessage("");
  }, []);

  return { verify, reset, state, message };
}
