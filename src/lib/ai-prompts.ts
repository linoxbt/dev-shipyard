import { z } from "zod";
import { SOLIDITY_SYSTEM_PROMPT } from "./ai";
import { SOLIDITY_AGENT_PROMPT } from "./ai-agent";
import { ROUTER_SYSTEM_PROMPT } from "./appgen/intent";
import { appBuilderSystemPrompt, reviewSystemPrompt, type PromptContext } from "./appgen/prompt";

// The system prompts the server-side AI proxy will spend the operator's key on.
//
// /api/ai used to forward any system prompt the browser sent, which made it a
// general-purpose relay for whoever held a wallet grant. Every prompt the app
// actually sends is one of these: three fixed ones, and the App Builder's two,
// which are built from a small context object. The browser sends that context
// alongside the prompt, the server rebuilds the prompt from it, and only an
// exact match is forwarded. Anything else, including a page from an older
// deploy whose prompts have since changed, is refused with a reason.

const FIXED = new Set([SOLIDITY_SYSTEM_PROMPT, SOLIDITY_AGENT_PROMPT, ROUTER_SYSTEM_PROMPT]);

/** Whether `system` is one of DevStation's own prompts. */
export function isKnownSystemPrompt(system: string, context?: unknown): boolean {
  if (FIXED.has(system)) return true;
  const ctx = promptContextOf(context);
  if (!ctx) return false;
  // The builders walk the ABI; a malformed entry that slips past the schema
  // must refuse the request, not crash the route.
  try {
    return system === appBuilderSystemPrompt(ctx) || system === reviewSystemPrompt(ctx);
  } catch {
    return false;
  }
}

const contextSchema = z.object({
  target: z.enum(["esm", "vite"]).optional(),
  contract: z
    .object({
      address: z.string().max(64),
      chainId: z.number().int(),
      chainName: z.string().max(200),
      rpcUrl: z.string().max(2000),
      explorerUrl: z.string().max(2000),
      nativeSymbol: z.string().max(32),
      abi: z.array(z.record(z.string(), z.unknown())).max(2000),
    })
    .nullable()
    .optional(),
});
// Unknown keys are stripped, not refused: the builders never read them, so
// the rebuilt prompt is the same either way.

/** The context object, if it has exactly the shape the prompt builders take. */
function promptContextOf(value: unknown): PromptContext | null {
  if (value === undefined || value === null) return null;
  // Bounded: the prompt that comes back can only be as large as this.
  try {
    if (JSON.stringify(value).length > 200_000) return null;
  } catch {
    return null;
  }
  const parsed = contextSchema.safeParse(value);
  return parsed.success ? (parsed.data as PromptContext) : null;
}
