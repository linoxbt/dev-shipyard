import { createFileRoute } from "@tanstack/react-router";

// Server-side AI proxy. When the deployment sets a server-only key (NO VITE_
// prefix, so it never enters the client bundle), the browser calls THIS route
// instead of the provider directly, and the key stays on the server.
//
// POST { system, messages }  → streams the provider's SSE response back
//                              verbatim, tagged with x-ai-provider so the
//                              client knows which delta format to parse.
// GET                        → { configured, provider } so the client can tell
//                              whether the proxy is usable.
//
// Enable on the client with VITE_AI_PROXY=true (public, just a flag). Without a
// server key, POST returns 501 and the client falls back to its direct path.

type Provider = "anthropic" | "openai";

interface ServerConfig {
  provider: Provider;
  anthropic: { endpoint: string; key: string; model: string };
  openai: { endpoint: string; key: string; model: string };
}

// Server-only env. process.env is shimmed across Nitro presets (Vercel/Netlify
// Node functions; Cloudflare via the build). These have NO VITE_ prefix on
// purpose — Vite only inlines VITE_*, so keys here never reach the browser.
function serverConfig(): ServerConfig {
  const e = process.env;
  // OpenRouter is an OpenAI-compatible provider, so it maps onto the "openai"
  // branch with the OpenRouter base URL. Setting OPENROUTER_API_KEY (e.g. in the
  // Netlify env) is the simplest way to provide a default key for all users.
  const openrouterKey = e.OPENROUTER_API_KEY || "";
  const openaiEndpoint =
    e.OPENAI_ENDPOINT ||
    e.AI_ENDPOINT ||
    (openrouterKey ? "https://openrouter.ai/api/v1/chat/completions" : "");
  const openaiKey = e.OPENAI_API_KEY || e.AI_API_KEY || openrouterKey;
  const openaiModel =
    e.OPENAI_MODEL || e.AI_MODEL || (openrouterKey ? "openai/gpt-4o-mini" : "gpt-4o-mini");

  const provider: Provider =
    (e.AI_PROVIDER as Provider) ||
    (e.ANTHROPIC_API_KEY ? "anthropic" : openaiKey ? "openai" : "anthropic");

  return {
    provider,
    anthropic: {
      endpoint: e.ANTHROPIC_ENDPOINT || "https://api.anthropic.com",
      key: e.ANTHROPIC_API_KEY || "",
      model: e.ANTHROPIC_MODEL || "claude-opus-4-8",
    },
    openai: {
      endpoint: openaiEndpoint,
      key: openaiKey,
      model: openaiModel,
    },
  };
}

function isConfigured(c: ServerConfig): boolean {
  return c.provider === "anthropic" ? !!c.anthropic.key : !!c.openai.endpoint && !!c.openai.key;
}

const MAX_TOKENS = 4096;

interface ChatBody {
  system?: unknown;
  messages?: unknown;
}

async function upstreamRequest(
  c: ServerConfig,
  system: string,
  messages: unknown[],
  signal: AbortSignal,
) {
  if (c.provider === "anthropic") {
    return fetch(`${c.anthropic.endpoint}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": c.anthropic.key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: c.anthropic.model,
        max_tokens: MAX_TOKENS,
        system,
        messages,
        stream: true,
      }),
      signal,
    });
  }
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${c.openai.key}`,
  };
  // OpenRouter recommends these attribution headers (harmless for plain OpenAI).
  if (c.openai.endpoint.includes("openrouter")) {
    headers["HTTP-Referer"] = "https://devstation.online";
    headers["X-Title"] = "DevStation";
  }
  return fetch(c.openai.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: c.openai.model,
      messages: [{ role: "system", content: system }, ...messages],
      temperature: 0.2,
      stream: true,
    }),
    signal,
  });
}

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      GET: () => {
        const c = serverConfig();
        const e = process.env;
        return Response.json({
          configured: isConfigured(c),
          provider: c.provider,
          // Diagnostic only: which key env vars this server function can see
          // (booleans — never the values). Lets us tell whether the host is
          // actually passing the key to the function. `build` confirms the
          // OpenRouter-aware code is the one running.
          build: "ai-2",
          seen: {
            OPENROUTER_API_KEY: !!e.OPENROUTER_API_KEY,
            OPENAI_API_KEY: !!e.OPENAI_API_KEY,
            AI_API_KEY: !!e.AI_API_KEY,
            ANTHROPIC_API_KEY: !!e.ANTHROPIC_API_KEY,
            AI_PROVIDER: e.AI_PROVIDER || null,
            VITE_AI_PROXY: e.VITE_AI_PROXY || null,
          },
        });
      },

      POST: async ({ request }) => {
        const c = serverConfig();
        if (!isConfigured(c)) {
          return Response.json(
            { error: { message: "Server AI proxy is not configured." } },
            { status: 501 },
          );
        }

        const body = (await request.json().catch(() => null)) as ChatBody | null;
        const system = typeof body?.system === "string" ? body.system : "";
        const messages = Array.isArray(body?.messages) ? body.messages : [];

        let upstream: Response;
        try {
          upstream = await upstreamRequest(c, system, messages, request.signal);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Upstream request failed";
          return Response.json({ error: { message } }, { status: 502 });
        }

        if (!upstream.ok || !upstream.body) {
          const text = await upstream.text().catch(() => "");
          return new Response(text || JSON.stringify({ error: { message: "Upstream error" } }), {
            status: upstream.status || 502,
            headers: { "content-type": "application/json" },
          });
        }

        // Stream the provider's SSE straight through; the client parses it by
        // the provider named in x-ai-provider.
        return new Response(upstream.body, {
          status: 200,
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache, no-transform",
            "x-ai-provider": c.provider,
          },
        });
      },
    },
  },
});
