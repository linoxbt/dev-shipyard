import { createFileRoute } from "@tanstack/react-router";
import { encodeDeployData, parseEther, type Abi } from "viem";
import { z } from "zod";
import { qieMainnet } from "@/lib/chains";
import { ONCHAIN_WRITE_GAS } from "@/lib/contracts";
import { sponsorClients, sponsorConfig, isSponsorConfigured } from "@/lib/sponsor/wallet.server";
import { getSponsorSpendLast24hWei } from "@/lib/sponsor/spend.server";
import { paddedTopupCost } from "@/lib/sponsor/pricing";

// Gas top-up for a deploy, QIE mainnet only. The sponsor wallet (configured
// server-side via SPONSOR_PRIVATE_KEY) sends the REQUESTER'S OWN wallet just
// enough QIE to cover the deploy plus the registry writes that follow it —
// it never broadcasts the deploy itself. The requester's wallet signs and
// sends everything (the CREATE, ProjectRegistry.recordDeployment,
// ContractLabelRegistry.submitLabel), so it's genuinely the deployer of
// record everywhere — no ownership caveats, no special-cased "who owns this"
// logic anywhere in the client.
//
// There is deliberately NO per-wallet/per-IP gate — see DEPLOYMENT.md's
// "Sponsored deploys" section for why. This is a real risk shift from a
// pure gas-payer: once QIE lands in the requester's wallet, nothing forces
// it to actually be spent on the deploy — the daily budget
// (SPONSOR_DAILY_BUDGET_QIE, cut off at 90% to leave headroom for
// concurrent in-flight requests) is the only backstop against it being used
// as a plain faucet.
//
// POST { chainId, requesterAddress, abi, bytecode, args }
//   → { ok: true, toppedUp: boolean, amountWei: string, txHash: string|null }
//   → { ok: false, reason: "not_configured"|"wrong_chain"|"invalid_body"
//                          |"budget_exhausted"|"topup_failed",
//       message }
// GET  → { configured, dailyBudgetQie, chainId } so the client can decide
//        whether to show the sponsored-deploy option at all.

const bodySchema = z.object({
  chainId: z.number(),
  requesterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  abi: z.array(z.unknown()).min(1),
  bytecode: z.string().regex(/^0x[0-9a-fA-F]+$/),
  args: z.array(z.unknown()).default([]),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

// The client JSON-stringifies bigint constructor args (a uint256 initial
// supply, say) as decimal strings, since JSON has no bigint type — this
// converts them back using the constructor's own ABI type info so gas
// estimation sees correctly-typed values. Handles plain numeric types and
// one level of array nesting (uint256[] etc.), which covers every
// constructor arg shape DevStation's templates and AI agent actually produce.
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

export const Route = createFileRoute("/api/sponsor-topup")({
  server: {
    handlers: {
      GET: () => {
        const cfg = sponsorConfig();
        return Response.json({
          configured: isSponsorConfigured(),
          dailyBudgetQie: cfg.dailyBudgetQie,
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
          return fail("invalid_body", "Malformed sponsor-topup request.", 400);
        }
        const { chainId, requesterAddress, abi, bytecode } = parsed.data;

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
        const { publicClient, walletClient } = clients;
        const cfg = sponsorConfig();
        const requester = requesterAddress as `0x${string}`;

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

        // Estimate as the REQUESTER, since they're the one who will actually
        // broadcast the deploy. Padding math (and why it's this generous)
        // lives in paddedTopupCost — shared with the client-side checks that
        // decide whether to offer sponsorship at all. Add headroom for the
        // two registry writes (ProjectRegistry + ContractLabelRegistry) that
        // follow the deploy from the same wallet, each pinned to
        // ONCHAIN_WRITE_GAS, so a top-up covers the whole flow in one shot.
        let gasEstimate: bigint;
        let gasPrice: bigint;
        let currentBalance: bigint;
        try {
          [gasEstimate, gasPrice, currentBalance] = await Promise.all([
            publicClient.estimateGas({ account: requester, data: deployData }),
            publicClient.getGasPrice(),
            publicClient.getBalance({ address: requester }),
          ]);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Gas estimation failed";
          return fail("topup_failed", message, 502);
        }
        const neededWei = paddedTopupCost(gasEstimate, gasPrice, 2n * ONCHAIN_WRITE_GAS);
        const shortfall = neededWei > currentBalance ? neededWei - currentBalance : 0n;

        if (shortfall === 0n) {
          return Response.json({ ok: true, toppedUp: false, amountWei: "0", txHash: null });
        }

        // Budget check: current rolling-24h spend + this top-up must stay
        // under 90% of the configured daily budget. The 10% headroom exists
        // because this check is not atomic across concurrent requests (see
        // spend.server.ts) — it reduces, not eliminates, the chance of a
        // burst of requests overshooting the configured cap.
        let spentWei: bigint;
        try {
          spentWei = await getSponsorSpendLast24hWei(chainId, clients.address);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not verify remaining budget";
          return fail("topup_failed", message, 502);
        }
        const budgetWei = (parseEther(String(cfg.dailyBudgetQie)) * 9n) / 10n;
        if (spentWei + shortfall > budgetWei) {
          return fail(
            "budget_exhausted",
            "Today's gas-sponsorship budget is used up. Deploy with your own wallet, or try again later.",
            429,
          );
        }

        try {
          const hash = await walletClient.sendTransaction({
            account: walletClient.account!,
            chain: qieMainnet,
            to: requester,
            value: shortfall,
          });
          await publicClient.waitForTransactionReceipt({ hash });
          return Response.json({
            ok: true,
            toppedUp: true,
            amountWei: shortfall.toString(),
            txHash: hash,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Top-up transfer failed";
          return fail("topup_failed", message, 502);
        }
      },
    },
  },
});
