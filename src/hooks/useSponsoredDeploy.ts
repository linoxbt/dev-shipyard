import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { qieMainnet } from "@/lib/chains";

interface SponsorStatusResponse {
  configured: boolean;
  dailyBudgetQie: number;
  chainId: number;
}

interface DeployParams {
  abi: unknown[];
  bytecode: `0x${string}`;
  args: unknown[];
  chainId: number;
  requesterAddress?: string;
}

export interface SponsoredDeployResult {
  contractAddress: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: number;
}

export interface SponsorError extends Error {
  reason:
    | "not_configured"
    | "wrong_chain"
    | "invalid_body"
    | "gas_too_high"
    | "budget_exhausted"
    | "deploy_failed";
}

// Gas-sponsored deploy on QIE mainnet: POSTs the compiled bytecode + args to
// /api/sponsor-deploy, which broadcasts the contract-creation transaction
// from a server-held wallet so the caller doesn't need any native QIE. Only
// ever available on QIE mainnet (see api.sponsor-deploy.ts) — callers should
// gate the UI on `available` AND the active chain being qieMainnet.id; the
// server independently re-checks the chain too.
export function useSponsoredDeploy() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sponsor-deploy-status"],
    queryFn: async (): Promise<SponsorStatusResponse> => {
      const res = await fetch("/api/sponsor-deploy");
      if (!res.ok) return { configured: false, dailyBudgetQie: 0, chainId: qieMainnet.id };
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const [pending, setPending] = useState(false);

  const deploySponsored = useCallback(async (p: DeployParams): Promise<SponsoredDeployResult> => {
    setPending(true);
    try {
      const res = await fetch("/api/sponsor-deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Constructor args like a uint256 initial supply are parsed as
        // native BigInt (see abiArgParser.ts), which JSON.stringify can't
        // serialize on its own — stringify every bigint as a decimal string;
        // the server converts them back using the ABI's own type info.
        body: JSON.stringify(p, (_key, value) =>
          typeof value === "bigint" ? value.toString() : value,
        ),
      });
      const json = await res.json();
      if (!json.ok) {
        const err = new Error(json.message || "Sponsored deploy failed") as SponsorError;
        err.reason = json.reason || "deploy_failed";
        throw err;
      }
      return {
        contractAddress: json.contractAddress as `0x${string}`,
        txHash: json.txHash as `0x${string}`,
        blockNumber: json.blockNumber as number,
      };
    } finally {
      setPending(false);
    }
  }, []);

  return {
    available: !!data?.configured,
    // Distinguishes "still checking" from "checked, and it's off" — a UI
    // that just renders nothing when `available` is false can't tell the
    // user which one happened, which reads as "sponsorship silently did
    // nothing" instead of an understandable status.
    checking: isLoading,
    checkFailed: isError,
    dailyBudgetQie: data?.dailyBudgetQie ?? 0,
    pending,
    deploySponsored,
  };
}
