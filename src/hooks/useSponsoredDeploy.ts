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
  const { data } = useQuery({
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
        body: JSON.stringify(p),
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
    dailyBudgetQie: data?.dailyBudgetQie ?? 0,
    pending,
    deploySponsored,
  };
}
