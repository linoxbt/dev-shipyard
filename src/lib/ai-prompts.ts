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
  return system === appBuilderSystemPrompt(ctx) || system === reviewSystemPrompt(ctx);
}

/** The context object, if it has the shape the prompt builders take. */
function promptContextOf(value: unknown): PromptContext | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  // Bounded: the prompt that comes back can only be as large as this.
  if (JSON.stringify(value).length > 200_000) return null;
  const v = value as Record<string, unknown>;
  if (v.target !== undefined && v.target !== "esm" && v.target !== "vite") return null;
  if (v.contract !== undefined && v.contract !== null && typeof v.contract !== "object") {
    return null;
  }
  return v as PromptContext;
}
