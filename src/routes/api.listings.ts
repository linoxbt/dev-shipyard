import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import { CLAIM_COOKIE, openClaims, ownerOf, readCookie } from "@/lib/agent-access/claims.server";

// Marketplace files: a thin proxy in front of the runner's /listings.
//
// The runner stores a listing's files and asks DevStationMarketplace on-chain
// who may have them. What it cannot check is WHO is asking: that is this
// route's job. The wallet sent on is the one that signed at /api/access, never
// one named in the request, so nobody can download under a buyer's address or
// upload under a creator's.
//
// Free listings download without signing in: the contract grants every wallet
// access to them, so the zero address is sent and the chain says yes.

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const ANONYMOUS = "0x0000000000000000000000000000000000000000";
const WINDOW_MS = 60 * 60 * 1000;
const DOWNLOADS_PER_IP = 240;
const UPLOADS_PER_IP = 30;
const UPLOADS_PER_WALLET = 20;

const ids = z.object({
  chainId: z.coerce
    .number()
    .int()
    .positive()
    .max(2 ** 32),
  id: z.coerce.number().int().min(0).max(999_999_999),
});

const uploadSchema = ids.extend({
  files: z.record(z.string(), z.string()),
});

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

function grantedWallet(request: Request): string | null {
  const owner = ownerOf(openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE)));
  return owner && ADDRESS.test(owner) ? owner : null;
}

function runnerConfig() {
  const e = process.env;
  return { url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""), token: e.RUNNER_TOKEN ?? "" };
}

async function toRunner(path: string, init: RequestInit, wallet: string, caller: string) {
  const cfg = runnerConfig();
  if (!cfg.url || !cfg.token) return null;
  return fetch(`${cfg.url}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${cfg.token}`,
      "x-devstation-owner": wallet,
      "x-devstation-caller": caller,
    },
  }).catch(() => null);
}

async function relay(res: Response | null) {
  if (!res) return fail("unreachable", "Marketplace files are unavailable right now.", 502);
  return new Response(await res.text(), {
    status: res.status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/listings")({
  server: {
    handlers: {
      // Download a listing's files: ?chainId=1990&id=3
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = ids.safeParse({
          chainId: url.searchParams.get("chainId"),
          id: url.searchParams.get("id"),
        });
        if (!parsed.success) return fail("invalid", "Unknown listing.", 400);
        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`listings:get:${ip}`, DOWNLOADS_PER_IP, WINDOW_MS)) {
          return fail("rate_limited", "Too many downloads. Try again later.", 429);
        }
        const wallet = grantedWallet(request) ?? ANONYMOUS;
        const res = await toRunner(
          `/listings/${parsed.data.chainId}/${parsed.data.id}`,
          { method: "GET" },
          wallet,
          ip,
        );
        return relay(res);
      },

      // Upload a listing's files, as its creator, after publishing on-chain.
      PUT: async ({ request }) => {
        const wallet = grantedWallet(request);
        if (!wallet) {
          return fail(
            "no_grant",
            "Connect your wallet and sign once to upload. It costs no gas.",
            401,
          );
        }
        const raw = await request.json().catch(() => null);
        const parsed = uploadSchema.safeParse(raw);
        if (!parsed.success) return fail("invalid_body", "Malformed upload.", 400);

        const ip = clientKeyFromRequest(request);
        if (!checkRateLimit(`listings:put:ip:${ip}`, UPLOADS_PER_IP, WINDOW_MS)) {
          return fail("rate_limited", "Too many uploads. Try again later.", 429);
        }
        if (
          !checkRateLimit(
            `listings:put:wallet:${wallet.toLowerCase()}`,
            UPLOADS_PER_WALLET,
            WINDOW_MS,
          )
        ) {
          return fail("rate_limited", "Too many uploads from this wallet.", 429);
        }
        const res = await toRunner(
          `/listings/${parsed.data.chainId}/${parsed.data.id}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ files: parsed.data.files }),
          },
          wallet,
          ip,
        );
        return relay(res);
      },
    },
  },
});
