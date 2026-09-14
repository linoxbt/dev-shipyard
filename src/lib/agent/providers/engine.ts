import type { ModelProvider, ProviderResult } from "./types";
import type { EngineId } from "./settings";

// A provider that is another agent: Claude Code or Codex, installed on this
// machine and signed in with the person's own account.
//
// This is how a Claude Pro/Max or ChatGPT Plus/Pro subscription does the work.
// DevStation never touches those sign-ins. Anthropic's terms do not let other
// tools use a Claude subscription's tokens, or offer a Claude.ai login of their
// own; they do let a person run the unmodified `claude` program with their own
// subscription, and OpenAI's `codex` works the same way. So a turn is handed to
// that program whole -- its own tools, its own permissions -- and DevStation
// shows what it does. See cli/engine-run.ts.

export class EngineProvider implements ModelProvider {
  /** Marks a provider the orchestrator must not drive: see isEngineProvider. */
  readonly engine = true as const;
  readonly model: string;

  constructor(
    readonly name: EngineId,
    model?: string | null,
  ) {
    // "default" lets that CLI choose, which is what its own settings say.
    this.model = model || "default";
  }

  generate(): Promise<ProviderResult> {
    return Promise.reject(
      new Error(
        `${this.name} runs a whole turn through its own CLI; it does not answer single model calls.`,
      ),
    );
  }
}

export function isEngineProvider(
  provider: ModelProvider | null | undefined,
): provider is EngineProvider {
  return Boolean(provider) && (provider as { engine?: unknown }).engine === true;
}

export const ENGINE_LABEL: Record<EngineId, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

/** The program each engine runs, and how a person signs in to it. */
export const ENGINE_BINARY: Record<EngineId, string> = { "claude-code": "claude", codex: "codex" };
export const ENGINE_SIGN_IN: Record<EngineId, string> = {
  "claude-code": "claude auth login",
  codex: "codex login",
};
export const ENGINE_INSTALL: Record<EngineId, string> = {
  "claude-code": "Install Claude Code (https://code.claude.com/docs/en/setup)",
  codex: "Install Codex with `npm install -g @openai/codex`",
};
