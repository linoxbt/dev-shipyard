import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";

interface SponsorStatusResponse {
  configured: boolean;
  dailyBudgetQie: number;
  chainId: number;
}

interface TopupParams {
  abi: unknown[];
  bytecode: `0x${string}`;
  args: unknown[];
  chainId: number;
  requesterAddress: `0x${string}`;
}

export interface TopupResult {
  toppedUp: boolean;
  amountWei: string;
  txHash: `0x${string}` | null;
}

export interface SponsorError extends Error {
  reason: "not_configured" | "wrong_chain" | "invalid_body" | "budget_exhausted" | "topup_failed";
}

// Gas top-up on whichever sponsor-eligible mainnet is active: POSTs the
// compiled bytecode + args to /api/sponsor-topup, which sends the
// REQUESTER'S OWN wallet just enough native gas token to cover the deploy
// (the server never broadcasts anything itself). The caller is responsible
// for running the actual deploy afterward through the connected wallet,
// exactly like a normal self-paid deploy — top-up first, then the existing
// deploy flow, unchanged. Only ever available on sponsor-eligible mainnets
// (see isSponsorEligibleChain in lib/sponsor/pricing.ts, and
// api.sponsor-topup.ts) — callers should gate the UI on `available`, which
// already reflects the passed-in chainId; the server independently
// re-checks the chain too.
export function useSponsorTopup(chainId: number) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["sponsor-topup-status", chainId],
    queryFn: async (): Promise<SponsorStatusResponse> => {
      const res = await fetch(`/api/sponsor-topup?chainId=${chainId}`);
      if (!res.ok) return { configured: false, dailyBudgetQie: 0, chainId };
      return res.json();
    },
    staleTime: 60_000,
    retry: false,
  });

  const [pending, setPending] = useState(false);

  const ensureFunded = useCallback(async (p: TopupParams): Promise<TopupResult> => {
    setPending(true);
    try {
      const res = await fetch("/api/sponsor-topup", {
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
        const err = new Error(json.message || "Gas top-up failed") as SponsorError;
        err.reason = json.reason || "topup_failed";
        throw err;
      }
      return {
        toppedUp: !!json.toppedUp,
        amountWei: json.amountWei as string,
        txHash: (json.txHash as `0x${string}` | null) ?? null,
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
    ensureFunded,
  };
}
