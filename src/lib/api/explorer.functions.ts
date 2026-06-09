import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { chainConfig } from "@/lib/chains";

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

const input = z.object({
  chainId: z.number(),
  path: z.string().min(1).max(512),
});

export const getExplorerData = createServerFn({ method: "GET" })
  .inputValidator(input)
  .handler(async ({ data }) => {
    const { chainId, path } = data;
    if (!ALLOWED.test(path)) {
      return { ok: false as const, status: 400, error: "Unsupported explorer path" };
    }
    const base = chainConfig(chainId).explorerUrl.replace(/\/$/, "");
    const url = `${base}/api/v2${path}`;
    try {
      const resp = await fetch(url, { headers: { accept: "application/json" } });
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
