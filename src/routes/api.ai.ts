import { createFileRoute } from "@tanstack/react-router";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

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
//
// Rate-limited (see rateLimit.server.ts): this route holds a shared,
// operator-funded provider key with no per-user auth, so an unlimited proxy
// would let anyone burn that key's entire budget. Both a per-IP and a global
// cap apply; neither is a hard distributed guarantee (see that module's
// header comment), but it closes the "loop a curl command forever" case.
const PER_IP_LIMIT = 20;
const GLOBAL_LIMIT = 300;
const WINDOW_MS = 5 * 60 * 1000;

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
  // Netlify env) is the simplest — and recommended — way to provide a default
  // key for all users: that one key reaches every model in the app's picker
  // (Claude, GPT, DeepSeek, Gemini, Grok, Qwen), so there's nothing else to
  // configure per vendor.
  const openrouterKey = e.OPENROUTER_API_KEY || "";
  const openaiEndpoint =
    e.OPENAI_ENDPOINT ||
    e.AI_ENDPOINT ||
    (openrouterKey ? "https://openrouter.ai/api/v1/chat/completions" : "");
  const openaiKey = e.OPENAI_API_KEY || e.AI_API_KEY || openrouterKey;
  // Default model when the operator doesn't pin one. Through OpenRouter this
  // must be a fully-qualified `vendor/model` id; direct OpenAI takes a bare id.
  const openaiModel =
    e.OPENAI_MODEL || e.AI_MODEL || (openrouterKey ? "anthropic/claude-sonnet-5" : "gpt-5.6-sol");

  // Prefer the OpenAI-compatible branch when a key for it exists — that's the
  // OpenRouter path, which serves every vendor. Only fall through to Anthropic
  // when an Anthropic key is the only thing configured.
  const provider: Provider =
    (e.AI_PROVIDER as Provider) ||
    (openaiKey ? "openai" : e.ANTHROPIC_API_KEY ? "anthropic" : "openai");

  return {
    provider,
    anthropic: {
      endpoint: e.ANTHROPIC_ENDPOINT || "https://api.anthropic.com",
      key: e.ANTHROPIC_API_KEY || "",
      model: e.ANTHROPIC_MODEL || "claude-opus-5",
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

// Catch env misconfigurations that are *detectable from the key's own shape*
// and would otherwise surface as a bare upstream 401 with no clue which var is
// wrong. This is a real failure we hit in production: an OpenRouter key
// (sk-or-...) had been stored as ANTHROPIC_API_KEY, with ANTHROPIC_ENDPOINT
// pointed at an unrelated router — so the proxy dutifully sent an OpenRouter
// key, in Anthropic Messages format, to a third party, and all the operator
// saw was "Invalid API key or token".
//
// Returns an operator-facing message, or null when nothing looks wrong. Only
// ever shown on POST (never GET) — see the GET handler's note about not
// handing anonymous callers a map of which keys are set.
function configProblem(c: ServerConfig): string | null {
  if (c.provider === "anthropic") {
    if (c.anthropic.key.startsWith("sk-or-")) {
      return "ANTHROPIC_API_KEY holds an OpenRouter key (sk-or-...). Set OPENROUTER_API_KEY instead, and either unset ANTHROPIC_API_KEY or set AI_PROVIDER=openai.";
    }
    if (c.anthropic.key && !c.anthropic.key.startsWith("sk-ant-")) {
      return "ANTHROPIC_API_KEY does not look like an Anthropic key (expected sk-ant-...). Check which provider that key belongs to.";
    }
    if (!c.anthropic.endpoint.includes("anthropic.com")) {
      return `ANTHROPIC_ENDPOINT points at ${c.anthropic.endpoint}, which is not Anthropic. Unset it unless you are deliberately proxying.`;
    }
  }
  return null;
}

// The App Builder must return the COMPLETE contents of every file it changes,
// and a generated app.js alone is ~2800 tokens. At 4096 a reply rewriting two
// or three files was cut off mid-function, saved as a broken file, and
// surfaced to the user as "needs another pass" with nothing they could do
// about it. Sized for a few complete files rather than one.
// anthropic/claude-sonnet-5 through OpenRouter allows 128k completion tokens
// against a 1M context (checked live against /api/v1/models). A real app is
// 15+ complete files — measured: a swap app truncated mid-run at 16000 and
// surfaced as "needs another pass" — so the ceiling is raised well above what
// one app costs while staying under the provider maximum.
const MAX_TOKENS = Number(process.env.AI_MAX_TOKENS ?? 64000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    // Some Anthropic-compatible routers (confirmed on 0G's router-api.0g.ai,
    // used to run this proxy against the same backend as the Lunex project)
    // 500 "upstream_error" on ANY request with a top-level `system` field —
    // isolated via direct testing: system alone fails, tools alone works,
    // folding the same instructions into the messages array as a synthetic
    // opening exchange works around it without changing what the model sees.
    // Harmless on real api.anthropic.com too, so this isn't provider-gated.
    const anthropicMessages = system
      ? [
          { role: "user", content: system },
          { role: "assistant", content: "Understood." },
          ...messages,
        ]
      : messages;

    const body = JSON.stringify({
      model: c.anthropic.model,
      max_tokens: MAX_TOKENS,
      messages: anthropicMessages,
      stream: true,
    });
    const headers = {
      "content-type": "application/json",
      "x-api-key": c.anthropic.key,
      "anthropic-version": "2023-06-01",
    };

    // Some provider nodes (0G's router included) have exactly one backing
    // node per model, so transient 404/500s are expected — retry up to 3
    // total attempts with a short backoff before surfacing the failure.
    // Only retry statuses that can plausibly succeed on a retry (routing
    // hiccups, rate limits, upstream 5xx) — a 400/401/403 means the request
    // or key is bad and will fail identically every time, so retrying it
    // just triples the latency (and, behind a shared rate-limited proxy,
    // the load) for a request that was never going to succeed.
    const RETRYABLE = new Set([404, 408, 409, 429, 500, 502, 503, 504]);
    let res: Response | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await fetch(`${c.anthropic.endpoint}/v1/messages`, {
        method: "POST",
        headers,
        body,
        signal,
      });
      if (res.ok || !RETRYABLE.has(res.status)) break;
      if (attempt < 2) await sleep(600 * (attempt + 1));
    }
    return res as Response;
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
      // Without this the OpenAI-compatible branch sent NO token cap at all
      // (the Anthropic branch above always has), so a long generation was
      // bounded only by the provider's own default.
      max_tokens: MAX_TOKENS,
      // Reasoning models stream `reasoning` deltas that carry no `content`.
      // Measured against this App Builder's own system prompt: the model
      // emitted 208 KB of pure reasoning and had still produced zero content
      // after 300s, which a serverless host kills long before the first
      // visible token — the user sees "Planning the app…" and then a network
      // error. Disabling it produced content in 2.4s instead. Set
      // AI_REASONING=on to restore provider-default reasoning.
      ...(process.env.AI_REASONING === "on" ? {} : { reasoning: { enabled: false } }),
    }),
    signal,
  });
}

export const Route = createFileRoute("/api/ai")({
  server: {
    handlers: {
      GET: () => {
        const c = serverConfig();
        // Deliberately minimal: earlier versions of this endpoint also
        // returned which specific key env vars were set (booleans, not
        // values) for debugging. That's reconnaissance for the abuse this
        // route rate-limits against, so it's gone — an anonymous caller only
        // learns whether SOME provider is configured, not which one/how.
        return Response.json({ configured: isConfigured(c) });
      },

      POST: async ({ request }) => {
        const ip = clientKeyFromRequest(request);
        if (
          !checkRateLimit(`ai:ip:${ip}`, PER_IP_LIMIT, WINDOW_MS) ||
          !checkRateLimit("ai:global", GLOBAL_LIMIT, WINDOW_MS)
        ) {
          return Response.json(
            { error: { message: "Rate limit exceeded. Try again shortly." } },
            { status: 429 },
          );
        }

        const c = serverConfig();
        if (!isConfigured(c)) {
          return Response.json(
            { error: { message: "Server AI proxy is not configured." } },
            { status: 501 },
          );
        }

        // Fail loudly on a provably-wrong key/endpoint pairing rather than
        // forwarding it and returning whatever 401 the upstream emits.
        const problem = configProblem(c);
        if (problem) {
          console.error(`[api/ai] misconfigured: ${problem}`);
          return Response.json(
            { error: { message: `Server AI proxy is misconfigured. ${problem}` } },
            { status: 500 },
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
