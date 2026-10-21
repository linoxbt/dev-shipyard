import https from "node:https";
import { SUPPORTED_CHAINS, chainConfig } from "@/lib/chains";

// Fetching block-explorer data when the explorer's certificate is broken.
//
// QIE's explorer certificates expired on 2026-08-30 and stayed expired. The
// service itself is fine: it answers normally once verification is skipped -
// but every server-side call failed with "certificate has expired", which took
// out the leaderboard, verification rate, ecosystem stats and address history.
//
// This tries TLS STRICTLY first and only falls back for a request that failed
// on the certificate specifically, to a host that appears in our own chain
// config. The moment the operator renews, the strict attempt succeeds and the
// fallback stops being reached: no redeploy, no code change.
//
// What is being traded, plainly: a relaxed request keeps its encryption but
// loses authentication, so an attacker positioned on the network path could
// serve false block data: a balance that is wrong, or a transaction shown as
// confirmed when it is not. That is why it is scoped to explorer reads (no
// credential is ever sent to these hosts), server-side only, and switchable.
//
// Set EXPLORER_ALLOW_EXPIRED_CERT=0 to turn the fallback off entirely and let
// these calls fail while the certificate is invalid.

/** Hostnames we will consider relaxing for: exactly the explorers this app
 *  ships, never an arbitrary URL a caller happens to pass in. */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const chain of SUPPORTED_CHAINS) {
    for (const raw of [chainConfig(chain.id).explorerUrl, chainConfig(chain.id).explorerApiUrl]) {
      try {
        hosts.add(new URL(raw).hostname.toLowerCase());
      } catch {
        /* a malformed configured URL simply never matches */
      }
    }
  }
  return hosts;
}

/** Opt-in. It defaulted on while QIE's explorer certificate was expired;
 *  that certificate was renewed on 2026-09-03, and verification relaxed by
 *  default is a standing exemption nobody remembers to remove. An operator
 *  who needs it again sets EXPLORER_ALLOW_EXPIRED_CERT=1. */
export function fallbackEnabled(): boolean {
  const raw = (process.env.EXPLORER_ALLOW_EXPIRED_CERT ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

/** Certificate problems only. A DNS failure, a refused connection or a 500 must
 *  NOT trigger a retry with verification disabled: those are not certificate
 *  problems, and treating them as one would quietly widen the exemption. */
const CERT_ERRORS =
  /certificate has expired|CERT_HAS_EXPIRED|unable to verify the first certificate|self.signed certificate|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT|ERR_TLS_CERT_ALTNAME_INVALID/i;

function isCertError(e: unknown): boolean {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 4 && cur; i++) {
    const err = cur as { message?: string; code?: string; cause?: unknown };
    if (err.message) parts.push(err.message);
    if (err.code) parts.push(err.code);
    cur = err.cause;
  }
  return CERT_ERRORS.test(parts.join(" "));
}

const warned = new Set<string>();

/** GET over https with verification disabled, via node:https because it behaves
 *  the same under Bun and under Node: Bun's own `tls` fetch option does not
 *  exist on the Netlify runtime, and undici is not a dependency. */
function insecureGet(url: string, headers: Record<string, string>): Promise<Response> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers,
        rejectUnauthorized: false,
        timeout: 20_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 502,
              headers: { "content-type": res.headers["content-type"] ?? "application/json" },
            }),
          ),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("explorer request timed out")));
    req.end();
  });
}

/** Whether a relaxed retry is permissible for this request at all.
 *
 *  Split out from fetchExplorer and exported so the guardrails can be tested
 *  directly. They used to be tested by calling the live QIE explorer and
 *  asserting it threw, which only held while QIE's certificate was expired.
 *  It was renewed on 2026-09-03 and both tests started failing, having never
 *  really tested this decision at all. A rule about what we permit should not
 *  depend on someone else's certificate being broken. */
export function mayRelax(url: string, method?: string): boolean {
  if (!fallbackEnabled()) return false;
  // Only GET is ever retried. A write with verification disabled is a
  // different risk entirely, and nothing here needs one.
  if (method && method.toUpperCase() !== "GET") return false;
  try {
    return allowedHosts().has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/** fetch() for explorer URLs, with the scoped certificate fallback above. */
export async function fetchExplorer(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (!isCertError(e)) throw e;
    if (!mayRelax(url, init?.method)) throw e;
    const host = new URL(url).hostname.toLowerCase();

    if (!warned.has(host)) {
      warned.add(host);
      console.warn(
        `[explorer] ${host} has an invalid TLS certificate; continuing with verification ` +
          `disabled for read-only explorer calls. Set EXPLORER_ALLOW_EXPIRED_CERT=0 to stop this.`,
      );
    }
    const headers: Record<string, string> = { accept: "application/json" };
    const given = init?.headers;
    if (given && typeof given === "object" && !Array.isArray(given)) {
      for (const [k, v] of Object.entries(given as Record<string, string>)) headers[k] = v;
    }
    return insecureGet(url, headers);
  }
}

// Short-lived cache for the explorer reads every open tab polls.
//
// The landing page, the explorer home and the analytics page each poll the
// same handful of registry tx lists, so N open tabs used to mean N identical
// full-history fetches per interval against a public Blockscout. Results are
// shared for a few seconds and concurrent misses share one request. Only
// successful responses are kept, and the map is bounded.
const CACHE_TTL_MS = 15_000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; status: number; type: string; body: string }>();
const inflight = new Map<string, Promise<{ status: number; type: string; body: string }>>();

function asResponse(hit: { status: number; type: string; body: string }): Response {
  return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.type } });
}

/** fetchExplorer for a GET whose result may be shared for `ttlMs`. */
export async function fetchExplorerCached(url: string, ttlMs = CACHE_TTL_MS): Promise<Response> {
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs) return asResponse(hit);

  let pending = inflight.get(url);
  if (!pending) {
    pending = (async () => {
      const resp = await fetchExplorer(url);
      const entry = {
        status: resp.status,
        type: resp.headers.get("content-type") ?? "application/json",
        body: await resp.text(),
      };
      if (resp.ok) {
        cache.delete(url);
        cache.set(url, { ...entry, at: Date.now() });
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
      }
      return entry;
    })().finally(() => inflight.delete(url));
    inflight.set(url, pending);
  }
  return asResponse(await pending);
}

/** For tests. */
export function clearExplorerCache(): void {
  cache.clear();
  inflight.clear();
}
