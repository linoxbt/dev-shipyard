import { createFileRoute } from "@tanstack/react-router";
import { encodeDeployData, parseEther, type Abi } from "viem";
import { z } from "zod";
import { qieMainnet } from "@/lib/chains";
import { sponsorClients, sponsorConfig, isSponsorConfigured } from "@/lib/sponsor/wallet.server";
import { getSponsorSpendLast24hWei } from "@/lib/sponsor/spend.server";

// Gas-sponsored contract deployment, QIE mainnet only. The sponsor wallet
// (configured server-side via SPONSOR_PRIVATE_KEY) broadcasts the CREATE
// transaction on the caller's behalf, so a visitor with zero QIE can still
// deploy. There is deliberately NO per-wallet/per-IP gate — see
// DEPLOYMENT.md's "Sponsored deploys" section for why, and what actually
// bounds exposure: a hard per-deploy gas ceiling (SPONSOR_MAX_GAS_PER_DEPLOY)
// so one request can't itself exceed the budget, and a rolling-24h spend
// check against SPONSOR_DAILY_BUDGET_QIE (cut off at 90% of the configured
// value to leave headroom for in-flight requests — see spend.server.ts).
//
// Ownership note: this route does not and cannot guarantee the deployed
// contract ends up owned/controlled by the caller rather than the sponsor
// wallet — that depends entirely on whether the submitted constructor takes
// an explicit owner/recipient argument instead of defaulting to
// `msg.sender`. DevStation's own LaunchKit templates and AI agent output are
// written to do this correctly; hand-written/pasted source is the caller's
// responsibility (the client shows a warning for non-template sources).
//
// POST { chainId, abi, bytecode, args, requesterAddress? }
//   → { ok: true, contractAddress, txHash }
//   → { ok: false, reason: "not_configured"|"wrong_chain"|"invalid_body"
//                          |"gas_too_high"|"budget_exhausted"|"deploy_failed",
//       message }
// GET  → { configured, dailyBudgetQie, maxGasPerDeploy } so the client can
//        decide whether to show the sponsored-deploy option at all.

const bodySchema = z.object({
  chainId: z.number(),
  abi: z.array(z.unknown()).min(1),
  bytecode: z.string().regex(/^0x[0-9a-fA-F]+$/),
  args: z.array(z.unknown()).default([]),
  requesterAddress: z.string().optional(),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

// The client JSON-stringifies bigint constructor args (a uint256 initial
// supply, say) as decimal strings, since JSON has no bigint type — this
// converts them back using the constructor's own ABI type info before
// they're encoded/deployed. Handles plain numeric types and one level of
// array nesting (uint256[] etc.), which covers every constructor arg shape
// DevStation's templates and AI agent actually produce.
function coerceArg(type: string | undefined, value: unknown): unknown {
  if (!type) return value;
  if (type.endsWith("[]")) {
    const inner = type.slice(0, -2);
    return Array.isArray(value) ? value.map((el) => coerceArg(inner, el)) : value;
  }
  if (/^u?int\d*$/.test(type) && (typeof value === "string" || typeof value === "number")) {
    try {
      return BigInt(value);
    } catch {
      return value;
    }
  }
  return value;
}

function coerceConstructorArgs(abi: Abi, args: unknown[]): unknown[] {
  const ctor = abi.find(
    (e): e is Extract<Abi[number], { type: "constructor" }> => e.type === "constructor",
  );
  const inputs = ctor?.inputs ?? [];
  return args.map((v, i) => coerceArg(inputs[i]?.type, v));
}

export const Route = createFileRoute("/api/sponsor-deploy")({
  server: {
    handlers: {
      GET: () => {
        const cfg = sponsorConfig();
        return Response.json({
          configured: isSponsorConfigured(),
          dailyBudgetQie: cfg.dailyBudgetQie,
          maxGasPerDeploy: cfg.maxGasPerDeploy.toString(),
          chainId: qieMainnet.id,
        });
      },

      POST: async ({ request }) => {
        if (!isSponsorConfigured()) {
          return fail(
            "not_configured",
            "Gas sponsorship is not configured on this deployment.",
            501,
          );
        }

        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return fail("invalid_body", "Malformed sponsor-deploy request.", 400);
        }
        const { chainId, abi, bytecode } = parsed.data;

        // Hard-pinned to QIE mainnet — chainId is never used to pick an RPC
        // or forwarded anywhere; it only gates this check.
        if (chainId !== qieMainnet.id) {
          return fail("wrong_chain", "Sponsored deploys are only available on QIE mainnet.", 400);
        }

        const args = coerceConstructorArgs(abi as Abi, parsed.data.args);

        const clients = sponsorClients();
        if (!clients) {
          return fail(
            "not_configured",
            "Gas sponsorship is not configured on this deployment.",
            501,
          );
        }
        const { address: sponsor, publicClient, walletClient } = clients;
        const cfg = sponsorConfig();

        let deployData: `0x${string}`;
        try {
          deployData = encodeDeployData({
            abi: abi as Abi,
            bytecode: bytecode as `0x${string}`,
            args: args as readonly unknown[],
          });
        } catch {
          return fail("invalid_body", "Could not encode constructor arguments.", 400);
        }

        // Estimate, then pad generously — QIE's eth_estimateGas is documented
        // (src/lib/contracts.ts) to lowball storage-writing calls by an order
        // of magnitude, and a CREATE running a constructor is exactly that
        // shape. Reject rather than cap-and-hope: an insufficient gas limit
        // just wastes the sponsor's spend on a reverted deploy.
        let gasEstimate: bigint;
        let gasPrice: bigint;
        try {
          [gasEstimate, gasPrice] = await Promise.all([
            publicClient.estimateGas({ account: sponsor, data: deployData }),
            publicClient.getGasPrice(),
          ]);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gas estimation failed";
          return fail("deploy_failed", message, 502);
        }
        const paddedGas = gasEstimate * 4n; // 4x safety margin over a known-lowballed estimate
        if (paddedGas > cfg.maxGasPerDeploy) {
          return fail(
            "gas_too_high",
            `Estimated deploy cost (${paddedGas} gas, padded) exceeds the sponsor's per-deploy ceiling (${cfg.maxGasPerDeploy} gas). Deploy with your own wallet instead.`,
            400,
          );
        }

        // Budget check: current rolling-24h spend + this deploy's projected
        // cost must stay under 90% of the configured daily budget. The 10%
        // headroom exists because this check is not atomic across concurrent
        // requests (see spend.server.ts) — it reduces, not eliminates, the
        // chance of a burst of requests overshooting the configured cap.
        let spentWei: bigint;
        try {
          spentWei = await getSponsorSpendLast24hWei(chainId, sponsor);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not verify remaining budget";
          return fail("deploy_failed", message, 502);
        }
        const budgetWei = (parseEther(String(cfg.dailyBudgetQie)) * 9n) / 10n;
        const projectedCostWei = paddedGas * gasPrice;
        if (spentWei + projectedCostWei > budgetWei) {
          return fail(
            "budget_exhausted",
            "Today's gas-sponsorship budget is used up. Deploy with your own wallet, or try again later.",
            429,
          );
        }

        try {
          const hash = await walletClient.deployContract({
            abi: abi as Abi,
            bytecode: bytecode as `0x${string}`,
            args: args as unknown[],
            gas: paddedGas,
            chain: qieMainnet,
            account: walletClient.account!,
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash });
          if (!receipt.contractAddress) {
            return fail("deploy_failed", "Deployment transaction had no contract address.", 502);
          }
          return Response.json({
            ok: true,
            contractAddress: receipt.contractAddress,
            txHash: hash,
            blockNumber: Number(receipt.blockNumber),
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Deploy failed";
          return fail("deploy_failed", message, 502);
        }
      },
    },
  },
});
