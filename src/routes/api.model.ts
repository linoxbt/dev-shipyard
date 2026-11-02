import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  providerForModel,
  type ProviderMessage,
  type ProviderTool,
  type ProviderUsage,
} from "@/lib/agent/providers";
import { costOfUsage, ratesFor } from "@/lib/agent/pricing";
import { isPremiumModel } from "@/lib/coding-agent/models";
import { accessOf } from "@/lib/db/access.server";
import { dbConfigured, insert, insertReturning, update } from "@/lib/db/admin.server";
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

/** Premium calls one account may start in a minute. A turn makes one call at
 *  a time, so this only bites calls fired side by side to outrun the balance. */
const PREMIUM_CALLS_PER_MINUTE = 20;

/** The longest answer a premium call may ask for. Each call is reserved
 *  against the balance at this size before it starts. */
const PREMIUM_MAX_TOKENS = 32_000;

/** Tokens in a piece of text, roughly: for a charge when the provider's own
 *  count never arrived (the call was cut off). */
const tokensIn = (chars: number) => Math.ceil(chars / 4);

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
        if (
          premium &&
          !(await checkRateLimit(`model-premium:${pass.owner}`, PREMIUM_CALLS_PER_MINUTE, 60_000))
        ) {
          return fail(429, "Too many premium model calls at once. Wait a moment.");
        }

        const maxTokens = premium
          ? Math.min(parsed.data.maxTokens ?? PREMIUM_MAX_TOKENS, PREMIUM_MAX_TOKENS)
          : parsed.data.maxTokens;
        const rates = ratesFor(provider.model);
        const inputTokens = tokensIn(
          JSON.stringify([parsed.data.system, parsed.data.messages, parsed.data.tools]).length,
        );
        const row = (usage: ProviderUsage) => ({
          cost_usd: Math.max(0, costOfUsage(usage, rates)),
          input_tokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
          output_tokens: usage.outputTokens,
        });
        const usageRow = {
          owner: pass.owner,
          workspace: pass.workspace.slice(0, 120),
          model: pass.model.slice(0, 60),
          premium,
        };

        // A premium call is charged before it starts, at the most it can
        // cost, and settled to what it did cost when it ends. Calls fired side
        // by side each see the others' charges, and a call cut off midway
        // keeps a charge: the provider bills it either way.
        let reserved: number | null = null;
        if (premium) {
          if (!dbConfigured()) return fail(503, "Premium models need the database to be set up.");
          try {
            const held = await insertReturning<{ id: number }>("model_usage", {
              ...usageRow,
              ...row({
                inputTokens,
                outputTokens: maxTokens ?? PREMIUM_MAX_TOKENS,
                cacheReadTokens: 0,
                cacheWriteTokens: 0,
              }),
            });
            reserved = held?.id ?? null;
          } catch {
            reserved = null;
          }
          if (reserved === null) {
            return fail(503, "This call could not be metered just now. Try again in a moment.");
          }
        }
        const settle = async (usage: ProviderUsage) => {
          if (!dbConfigured()) return;
          try {
            if (reserved !== null) await update("model_usage", `id=eq.${reserved}`, row(usage));
            else await insert("model_usage", { ...usageRow, ...row(usage) });
          } catch (error) {
            // A reservation that cannot be settled stays at its full size:
            // the account is overcharged for one call, never undercharged.
            console.error("model_usage write failed", error);
          }
        };

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
            let streamed = 0;
            try {
              const result = await provider.generate({
                system: parsed.data.system,
                messages: parsed.data.messages as unknown as ProviderMessage[],
                tools: parsed.data.tools as ProviderTool[] | undefined,
                maxTokens,
                signal: abort.signal,
                onDelta: (chunk) => {
                  streamed += chunk.length;
                  send({ d: chunk });
                },
              });
              await settle(result.usage);
              const cost = costOfUsage(result.usage, ratesFor(result.model || provider.model));
              send({ r: { ...result, usage: { ...result.usage, costUsd: cost } } });
            } catch (error) {
              // Cut off by the caller, or failed after answering: charged as
              // estimated from what was sent. A provider error before any
              // answer (an outage, a refusal) is not billed, so costs nothing.
              const charged = streamed > 0 || abort.signal.aborted;
              if (charged || reserved !== null) {
                await settle({
                  inputTokens: charged ? inputTokens : 0,
                  outputTokens: tokensIn(streamed),
                  cacheReadTokens: 0,
                  cacheWriteTokens: 0,
                });
              }
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
