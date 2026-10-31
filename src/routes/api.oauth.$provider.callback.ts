import { createFileRoute } from "@tanstack/react-router";
import { isConnectorId, saveGrant } from "@/lib/db/connectors.server";
import { exchangeCode, readState, safeBack } from "@/lib/db/oauth.server";
import { requestOwner } from "@/lib/db/request.server";

// Where a provider sends the person back after they approve (or decline)
// access. Checks the sealed state, swaps the code for a grant, keeps it, and
// returns to the page they started from with the outcome in the address.

export const Route = createFileRoute("/api/oauth/$provider/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const id = params.provider;
        const go = (back: string, outcome: string) =>
          new Response(null, {
            status: 302,
            headers: {
              location: `${back}${back.includes("?") ? "&" : "?"}${outcome}`,
              "cache-control": "no-store",
            },
          });
        if (!isConnectorId(id)) return go("/", "connect_error=unknown");

        const state = readState(url.searchParams.get("state"), id, requestOwner(request));
        if (!state) return go("/", "connect_error=bad_state");
        const back = safeBack(state.back);

        const code = url.searchParams.get("code");
        if (!code) {
          const denied = url.searchParams.get("error") === "access_denied";
          return go(back, `connect_error=${denied ? "denied" : "no_code"}&provider=${id}`);
        }
        const grant = await exchangeCode(request, id, code, state.v);
        if (!grant) return go(back, `connect_error=exchange_failed&provider=${id}`);
        const saved = await saveGrant(state.o, id, grant).catch(() => null);
        if (!saved) return go(back, `connect_error=save_failed&provider=${id}`);
        // An install begun on Vercel's own marketplace finishes there, at
        // `next`; one begun here comes back here.
        const next = url.searchParams.get("next");
        const external = url.searchParams.get("source") === "external";
        if (id === "vercel" && !external && next?.startsWith("https://vercel.com/")) {
          return new Response(null, { status: 302, headers: { location: next } });
        }
        return go(back, `connected=${id}`);
      },
    },
  },
});
