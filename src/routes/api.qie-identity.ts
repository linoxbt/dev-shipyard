import { createFileRoute } from "@tanstack/react-router";
import { createHmac } from "node:crypto";
import { z } from "zod";
import { verifyMessage } from "viem";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import { QIE_CLAIMS } from "@/lib/qie/identity";
import {
  AUTH_PROBLEM_MESSAGE,
  identifierAllowed,
  issuedAtProblem,
  verifyRequestMessage,
} from "@/lib/qie/request-auth";

// Proxy for QIE's identity (QIE Pass) partner API.
//
// It exists for one reason: the partner API authenticates with an HMAC over a
// shared secret, and that secret cannot go anywhere near a browser. Anyone
// holding it can create verification requests in DevStation's name — which
// send real consent prompts to real people — so it stays here and the client
// only ever talks to this route.
//
// This is a CONSENT flow, not a lookup. Creating a request notifies the user
// and asks them to approve; it is never fired automatically on wallet connect,
// because that would spam people with prompts they did not ask for. The client
// calls this only when the user presses the button.

const PER_IP_LIMIT = 20;
/** A person verifies once, maybe twice if something goes wrong. */
const PER_WALLET_LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;
const API_BASE = "https://did-stapi.qie.digital/api/v1";

const createSchema = z.object({
  action: z.literal("create"),
  /** QIE accepts a wallet, @username or name.qie. DevStation only ever sends
   *  the signing wallet's own address — see request-auth.ts for why. */
  identifier: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  claims: z.array(z.enum(QIE_CLAIMS)).min(1).max(QIE_CLAIMS.length),
  /** Proof the caller controls the wallet being verified. */
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  issuedAt: z.number().int().positive(),
});

const statusSchema = z.object({
  action: z.literal("status"),
  requestId: z.string().min(3).max(120),
});

const bodySchema = z.discriminatedUnion("action", [createSchema, statusSchema]);

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

// Read per request: some hosts bind env per request, where a module-level read
// is undefined.
function serverConfig() {
  const e = process.env;
  return {
    publicKey: e.QIE_PARTNER_PUBLIC_KEY ?? "",
    secret: e.QIE_PARTNER_API_SECRET ?? "",
    base: (e.QIE_IDENTITY_API_BASE ?? API_BASE).replace(/\/+$/, ""),
  };
}

/** QIE's scheme: HMAC-SHA256 over publicKey + timestamp, keyed by the secret. */
function authHeaders(publicKey: string, secret: string): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", secret)
    .update(publicKey + timestamp)
    .digest("hex");
  return {
    "X-Public-Key": publicKey,
    "X-Signature": signature,
    "X-Timestamp": timestamp,
    "content-type": "application/json",
  };
}

export const Route = createFileRoute("/api/qie-identity")({
  server: {
    handlers: {
      // Reports only whether QIE Pass is available here, never which
      // variables are set.
      GET: () => {
        const cfg = serverConfig();
        return Response.json({
          configured: cfg.publicKey.length > 0 && cfg.secret.length > 0,
          claims: QIE_CLAIMS,
        });
      },

      POST: async ({ request }) => {
        const raw = await request.json().catch(() => null);
        const parsed = bodySchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed identity request.", 400);

        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`qieid:ip:${ip}`, PER_IP_LIMIT, WINDOW_MS)) {
          return fail("rate_limited", "Too many verification requests. Try again later.", 429);
        }

        // A create request makes QIE notify a real person. Prove the caller
        // controls the wallet before spending DevStation's partner credentials
        // on it — an IP limit alone lets anyone aim prompts at anyone.
        if (parsed.data.action === "create") {
          const { address, identifier, signature, issuedAt } = parsed.data;

          if (!identifierAllowed(address, identifier)) {
            return fail("identifier_mismatch", AUTH_PROBLEM_MESSAGE.identifier_mismatch, 403);
          }
          const timing = issuedAtProblem(issuedAt);
          if (timing) return fail(timing, AUTH_PROBLEM_MESSAGE[timing], 401);

          const valid = await verifyMessage({
            address: address as `0x${string}`,
            message: verifyRequestMessage({ address, identifier, issuedAt }),
            signature: signature as `0x${string}`,
          }).catch(() => false);
          if (!valid) {
            return fail("bad_signature", AUTH_PROBLEM_MESSAGE.bad_signature, 401);
          }

          // Per wallet, not just per IP: IPs are cheap, wallets are not.
          if (
            !checkRateLimit(`qieid:wallet:${address.toLowerCase()}`, PER_WALLET_LIMIT, WINDOW_MS)
          ) {
            return fail("rate_limited", "Too many verification requests for this wallet.", 429);
          }
        }

        const cfg = serverConfig();
        if (!cfg.publicKey || !cfg.secret) {
          return fail(
            "not_configured",
            "QIE Pass is not configured on this deployment. Add partner credentials from getpass.qie.digital to enable identity verification.",
            501,
          );
        }

        const headers = authHeaders(cfg.publicKey, cfg.secret);
        const url =
          parsed.data.action === "create"
            ? `${cfg.base}/partners/verification-requests`
            : `${cfg.base}/partners/verification-requests/${encodeURIComponent(parsed.data.requestId)}`;

        try {
          const res = await fetch(url, {
            method: parsed.data.action === "create" ? "POST" : "GET",
            headers,
            body:
              parsed.data.action === "create"
                ? JSON.stringify({
                    identifier: parsed.data.identifier,
                    requestedClaims: parsed.data.claims,
                  })
                : undefined,
            signal: AbortSignal.timeout(30_000),
          });
          const body = (await res.json().catch(() => null)) as {
            success?: boolean;
            data?: unknown;
            message?: string;
          } | null;

          if (!res.ok || !body?.success) {
            return Response.json(
              {
                ok: false,
                reason: "qie_error",
                // QIE's own message is more useful than anything invented here,
                // but the status code is not leaked as a raw technical error.
                message: body?.message ?? `QIE Identity returned ${res.status}.`,
              },
              { status: res.status === 401 ? 502 : 502 },
            );
          }
          return Response.json({ ok: true, data: body.data });
        } catch (e) {
          const timedOut = e instanceof Error && e.name === "TimeoutError";
          return fail(
            timedOut ? "timeout" : "unreachable",
            timedOut ? "QIE Identity did not respond in time." : "Could not reach QIE Identity.",
            504,
          );
        }
      },
    },
  },
});
