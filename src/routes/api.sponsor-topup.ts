import { createFileRoute } from "@tanstack/react-router";
import { encodeDeployData, parseEther, type Abi } from "viem";
import { z } from "zod";
import { qieMainnet } from "@/lib/chains";
import { ONCHAIN_WRITE_GAS } from "@/lib/contracts";
import { sponsorClients, sponsorConfig, isSponsorConfigured } from "@/lib/sponsor/wallet.server";
import { getSponsorSpendLast24hWei } from "@/lib/sponsor/spend.server";
import { paddedTopupCost, isSponsorEligibleChain } from "@/lib/sponsor/pricing";
import { topupMessage, issuedAtProblem } from "@/lib/sponsor/request-auth";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import { verifyMessage } from "viem";

// Gas top-up for a deploy, on whichever mainnets are sponsor-eligible (see
// isSponsorEligibleChain: QIE and BOT Chain mainnet today). The sponsor
// wallet for that chain (configured server-side, e.g. via
// SPONSOR_PRIVATE_KEY / SPONSOR_PRIVATE_KEY_BOT) sends the REQUESTER'S OWN
// wallet just enough native gas token to cover the deploy plus the registry
// writes that follow it: it never broadcasts the deploy itself. The
// requester's wallet signs and sends everything (the CREATE,
// ProjectRegistry.recordDeployment, ContractLabelRegistry.submitLabel), so
// it's genuinely the deployer of record everywhere: no ownership caveats,
// no special-cased "who owns this" logic anywhere in the client.
//
// There is deliberately NO per-wallet/per-IP gate: see DEPLOYMENT.md's
// "Sponsored deploys" section for why. This is a real risk shift from a
// pure gas-payer: once the native token lands in the requester's wallet,
// nothing forces it to actually be spent on the deploy, each chain's daily
// budget (cut off at 90% to leave headroom for concurrent in-flight
// requests) is the only backstop against it being used as a plain faucet.
//
// POST { chainId, requesterAddress, abi, bytecode, args }
//   → { ok: true, toppedUp: boolean, amountWei: string, txHash: string|null }
//   → { ok: false, reason: "not_configured"|"wrong_chain"|"invalid_body"
//                          |"unauthorized"|"rate_limited"
//                          |"budget_exhausted"|"topup_failed",
//       message }
// GET ?chainId=<id> → { configured, dailyBudgetQie, chainId } for that
//        specific chain, so the client can decide whether to show the
//        sponsored-deploy option for whatever network is currently active.

const bodySchema = z.object({
  chainId: z.number(),
  requesterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  abi: z.array(z.unknown()).min(1),
  bytecode: z.string().regex(/^0x[0-9a-fA-F]+$/),
  args: z.array(z.unknown()).default([]),
  // Proof the caller controls requesterAddress. See sponsor/request-auth.ts -
  // without it this endpoint funds any address anyone names.
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  issuedAt: z.number(),
});

// This endpoint spends real mainnet funds, so it is limited far more tightly
// than the AI proxy. Per-wallet is the meaningful one (an attacker can rotate
// IPs more cheaply than they can produce signatures from distinct wallets);
// per-IP blunts trivially-scripted abuse; the global cap bounds the blast
// radius of a distributed attempt within a window. The rolling 24h on-chain
// budget remains the final backstop.
const TOPUP_PER_WALLET_LIMIT = 3;
const TOPUP_PER_IP_LIMIT = 5;
const TOPUP_GLOBAL_LIMIT = 40;
const TOPUP_WINDOW_MS = 60 * 60 * 1000;

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

// The client JSON-stringifies bigint constructor args (a uint256 initial
// supply, say) as decimal strings, since JSON has no bigint type: this
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
      GET: ({ request }) => {
        const url = new URL(request.url);
        const chainId = Number(url.searchParams.get("chainId")) || qieMainnet.id;
        const cfg = sponsorConfig(chainId);
        return Response.json({
          configured: isSponsorEligibleChain(chainId) && isSponsorConfigured(chainId),
          dailyBudgetQie: cfg.dailyBudgetNative,
          chainId,
        });
      },

      POST: async ({ request }) => {
        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) {
          return fail("invalid_body", "Malformed sponsor-topup request.", 400);
        }
        const { chainId, requesterAddress, abi, bytecode, signature, issuedAt } = parsed.data;
        const requesterKey = requesterAddress.toLowerCase();

        // --- Authorisation, before any RPC work or spending -----------------
        // Reject a stale or future-dated request first (cheapest check), then
        // verify the signature actually recovers to the address we would be
        // funding. Both must pass before the wallet is touched.
        const timeProblem = issuedAtProblem(issuedAt);
        if (timeProblem) {
          return fail(
            "unauthorized",
            timeProblem === "future"
              ? "Request timestamp is in the future. Check your system clock."
              : "This top-up request has expired. Try the deploy again.",
            401,
          );
        }

        // viem's pure verifyMessage recovers an EOA signature with no RPC call.
        // That is deliberate: it runs BEFORE the rate-limit check, so it must
        // stay cheap and must not let an unauthenticated caller drive RPC
        // traffic. The trade-off is that it does not support smart-contract
        // wallets (ERC-1271): fine today, because every configured connector
        // (injected, metaMask, the in-app burner) is an EOA. If a
        // contract-wallet connector is ever added, switch to
        // publicClient.verifyMessage and move this AFTER the rate-limit check.
        let signatureValid = false;
        try {
          signatureValid = await verifyMessage({
            address: requesterAddress as `0x${string}`,
            message: topupMessage({ address: requesterAddress, chainId, issuedAt }),
            signature: signature as `0x${string}`,
          });
        } catch {
          signatureValid = false;
        }
        if (!signatureValid) {
          return fail(
            "unauthorized",
            "Could not verify that you control this wallet. Reconnect and try again.",
            401,
          );
        }

        // --- Abuse limits ----------------------------------------------------
        const ip = clientKeyFromRequest(request);
        if (
          !checkRateLimit(
            `topup:wallet:${requesterKey}`,
            TOPUP_PER_WALLET_LIMIT,
            TOPUP_WINDOW_MS,
          ) ||
          !checkRateLimit(`topup:ip:${ip}`, TOPUP_PER_IP_LIMIT, TOPUP_WINDOW_MS) ||
          !checkRateLimit("topup:global", TOPUP_GLOBAL_LIMIT, TOPUP_WINDOW_MS)
        ) {
          return fail(
            "rate_limited",
            "Too many gas top-up requests. Wait a little, or deploy with your own gas.",
            429,
          );
        }

        // Only chains in the eligible-chains table (mainnets with a
        // configured sponsor wallet) are ever reachable here: chainId
        // picks which sponsor wallet/RPC client is used, via
        // sponsorClients(chainId).
        if (!isSponsorEligibleChain(chainId)) {
          return fail(
            "wrong_chain",
            "Sponsored deploys are only available on QIE mainnet or BOT Chain mainnet.",
            400,
          );
        }
        if (!isSponsorConfigured(chainId)) {
          return fail(
            "not_configured",
            "Gas sponsorship is not configured for this chain on this deployment.",
            501,
          );
        }

        const args = coerceConstructorArgs(abi as Abi, parsed.data.args);

        const clients = sponsorClients(chainId);
        if (!clients) {
          return fail(
            "not_configured",
            "Gas sponsorship is not configured for this chain on this deployment.",
            501,
          );
        }
        const { publicClient, walletClient, chain } = clients;
        const cfg = sponsorConfig(chainId);
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
        // lives in paddedTopupCost: shared with the client-side checks that
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
        // spend.server.ts): it reduces, not eliminates, the chance of a
        // burst of requests overshooting the configured cap.
        let spentWei: bigint;
        try {
          spentWei = await getSponsorSpendLast24hWei(chainId, clients.address);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Could not verify remaining budget";
          return fail("topup_failed", message, 502);
        }
        const budgetWei = (parseEther(String(cfg.dailyBudgetNative)) * 9n) / 10n;
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
            chain,
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
