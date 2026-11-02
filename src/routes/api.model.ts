import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { providerForModel, type ProviderMessage, type ProviderTool } from "@/lib/agent/providers";
import { costOfUsage, ratesFor } from "@/lib/agent/pricing";
import { isPremiumModel } from "@/lib/coding-agent/models";
import { accessOf } from "@/lib/db/access.server";
import { dbConfigured, insert } from "@/lib/db/admin.server";
import { passFromRequest } from "@/lib/db/turn-token.server";
import { checkRateLimit } from "@/lib/rateLimit.server";

// The model proxy. A sandbox never holds a model key: for each model call of a
// turn it sends the conversation here with the turn's pass
// (lib/db/turn-token.server.ts), and this server checks the pass, checks that
// the sender may still use a premium model (on every call, so credit cannot
// run far past zero), makes the call with its own key, streams the reply back
// and records what the call cost against the sender.
//
// The reply is newline-delimited JSON: {"d": text} as prose arrives, {"k": 1}
// to keep a quiet connection open, then {"r": result} or {"e": message}.

const body = z.object({
  system: z.string().max(400_000),
  messages: z.array(z.record(z.string(), z.unknown())).max(4000),
  tools: z
    .array(
      z.object({
        name: z.string().max(120),
        description: z.string().max(8000),
        inputSchema: z.record(z.string(), z.unknown()),
      }),
    )
    .max(200)
    .optional(),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
});

/** Calls one account may make in ten minutes: a turn takes at most 60 steps. */
const CALLS_PER_WINDOW = 240;

const fail = (status: number, message: string) => Response.json({ ok: false, message }, { status });

export const Route = createFileRoute("/api/model")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const pass = passFromRequest(request);
        if (!pass) return fail(401, "This turn's pass is missing or has expired.");
        if (!(await checkRateLimit(`model:${pass.owner}`, CALLS_PER_WINDOW, 10 * 60_000))) {
          return fail(429, "Too many model calls. Wait a moment.");
        }
        const parsed = body.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail(400, "Malformed model request.");

        const premium = isPremiumModel(pass.model);
        if (premium) {
          let allowed = false;
          try {
            allowed = (await accessOf(pass.owner)).premium;
          } catch {
            return fail(503, "Plans could not be checked just now. Try again in a moment.");
          }
          if (!allowed) {
            return fail(
              402,
              "Your launch credit is used up, or this account has no upgrade. Switch to Qwen, which is free, or upgrade.",
            );
          }
        }

        const chosen = providerForModel(pass.model);
        if ("problem" in chosen) return fail(503, chosen.problem);
        const { provider } = chosen;

        const encoder = new TextEncoder();
        const abort = new AbortController();
        request.signal?.addEventListener("abort", () => abort.abort());
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (line: unknown) => {
              try {
                controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
              } catch {
                // The sandbox went away; the call is aborted below.
              }
            };
            const keepAlive = setInterval(() => send({ k: 1 }), 15_000);
            try {
              const result = await provider.generate({
                system: parsed.data.system,
                messages: parsed.data.messages as unknown as ProviderMessage[],
                tools: parsed.data.tools as ProviderTool[] | undefined,
                maxTokens: parsed.data.maxTokens,
                signal: abort.signal,
                onDelta: (chunk) => send({ d: chunk }),
              });
              const cost = costOfUsage(result.usage, ratesFor(result.model || provider.model));
              if (dbConfigured()) {
                await insert("model_usage", {
                  owner: pass.owner,
                  workspace: pass.workspace.slice(0, 120),
                  model: pass.model.slice(0, 60),
                  premium,
                  cost_usd: Math.max(0, cost),
                  input_tokens: result.usage.inputTokens,
                  output_tokens: result.usage.outputTokens,
                }).catch((error) => {
                  // A lost row is lost revenue, never a lost answer.
                  console.error("model_usage insert failed", error);
                });
              }
              send({ r: { ...result, usage: { ...result.usage, costUsd: cost } } });
            } catch (error) {
              send({
                e: error instanceof Error ? error.message.slice(0, 500) : "The model call failed.",
              });
            } finally {
              clearInterval(keepAlive);
              controller.close();
            }
          },
          cancel() {
            abort.abort();
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "application/x-ndjson; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
