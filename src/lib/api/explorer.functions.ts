import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { chainConfig } from "@/lib/chains";
import { fetchExplorer } from "@/lib/api/explorer-fetch";

// Server-side proxy to the QIE explorer's Blockscout v2 API. Fetching from the
// server avoids browser CORS limits and keeps the explorer working in SSR. The
// host is fixed by chainId (testnet vs mainnet); only the path within /api/v2
// varies, and it is validated against the known resource namespace so this
// cannot be used to fetch arbitrary URLs.

// JSON-serializable value type (TanStack Start validates server-fn returns are
// serializable, so the proxied Blockscout payload can't be typed as `unknown`).
type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

const ALLOWED =
  /^\/(stats|main-page|blocks|transactions|tokens|addresses|search|smart-contracts)(\/|\?|$)/;

/**
 * Whether `path` stays inside the allowed Blockscout namespaces once a URL
 * parser has normalised it. A literal ".." check missed "%2e%2e", which the
 * WHATWG parser treats as a dot segment ("/blocks/%2e%2e/%2e%2e/admin" became
 * "/api/admin"), so the path is resolved the same way fetch will resolve it
 * and the prefix is checked on the result.
 */
export function explorerPathAllowed(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
  if (/(^|\/)(\.|%2e){1,2}(\/|\?|$)/i.test(path)) return false;
  let resolved: URL;
  try {
    resolved = new URL(`https://explorer.invalid/api/v2${path}`);
  } catch {
    return false;
  }
  if (resolved.host !== "explorer.invalid" || !resolved.pathname.startsWith("/api/v2/")) {
    return false;
  }
  return ALLOWED.test(resolved.pathname.slice("/api/v2".length) + resolved.search);
}

const input = z.object({
  chainId: z.number(),
  path: z.string().min(1).max(512),
});

export const getExplorerData = createServerFn({ method: "GET" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const { chainId, path } = data;
    // Same-host path traversal, not SSRF: the host is always the fixed,
    // chainId-derived explorerUrl below. See explorerPathAllowed.
    if (!explorerPathAllowed(path)) {
      return { ok: false as const, status: 400, error: "Unsupported explorer path" };
    }
    const base = chainConfig(chainId).explorerUrl.replace(/\/$/, "");
    const url = `${base}/api/v2${path}`;
    try {
      const resp = await fetchExplorer(url, { headers: { accept: "application/json" } });
      if (!resp.ok) {
        return {
          ok: false as const,
          status: resp.status,
          error: `Explorer returned ${resp.status}`,
        };
      }
      const json = (await resp.json()) as JsonValue;
      return { ok: true as const, status: 200, data: json };
    } catch (e) {
      return {
        ok: false as const,
        status: 502,
        error: e instanceof Error ? e.message : "Explorer unreachable",
      };
    }
  });
