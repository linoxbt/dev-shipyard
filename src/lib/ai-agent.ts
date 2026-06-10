// Text-protocol agent for the autonomous "Code with AI" page. The model drives
// tools (compile, deploy) by ending a message with ONE directive line; the
// client (useCodeAgent) parses it, runs the tool, and feeds the result back as
// the next turn. This works across all providers (Anthropic / OpenAI /
// OpenRouter proxy) because it rides on plain streamed text — no provider-
// specific function-calling API.

import type { CompileError } from "@/lib/compiler";

export const SOLIDITY_AGENT_PROMPT = `You are an autonomous Solidity build agent inside DevStation, a developer console for the QIE blockchain (an EVM chain). You can WRITE, COMPILE, FIX, and DEPLOY smart contracts by driving tools.

You drive tools by ending a message with EXACTLY ONE directive line, on its own line, as the LAST line of the message:

  @@COMPILE name=<ContractName>
      Compiles the Solidity you include in this same message. You MUST include the COMPLETE contract source in a single \`\`\`solidity fenced code block (never diffs or partial snippets). <ContractName> is the contract to deploy.

  @@DEPLOY name=<ContractName> args=[...]
      Deploys the most recently compiled contract. "args" is a JSON array of constructor arguments in order, matching the constructor inputs. Use [] when there are no constructor args. For any address argument that should be the user's own wallet (owner, initialOwner, recipient, etc.), use the string "$WALLET" and it will be replaced with the connected wallet address.

  @@DONE
      You are finished. Use this after a successful deploy, or when no deploy was requested.

Rules:
- Use Solidity pragma ^0.8.20. You may import OpenZeppelin (e.g. "@openzeppelin/contracts/...") — imports are resolved automatically.
- When you compile, ALWAYS emit the entire contract in one \`\`\`solidity block. When you fix a compile error, re-emit the FULL corrected source, not just the changed lines.
- Standard flow: write the contract -> @@COMPILE. If it fails, read the compiler errors I send back, fix the full source, and @@COMPILE again. Once it compiles AND the user asked to deploy, @@DEPLOY. Then briefly summarize and @@DONE.
- If the user only asked you to write/explain (not deploy), compile to verify, then @@DONE without deploying.
- Exactly ONE directive per message, and it must be the final line. Keep your prose short and focused.`;

export type AgentAction =
  | { kind: "compile"; name?: string; source: string | null }
  | { kind: "deploy"; name?: string; args: unknown[] }
  | { kind: "done" }
  | { kind: "none" };

// Pull the last fenced code block out of an assistant message (the full,
// most-recent contract source the model wants compiled).
export function extractLastSolidity(text: string): string | null {
  const re = /```(?:solidity|sol)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text)) !== null) last = m[1].replace(/\s+$/, "");
  return last;
}

// Parse the LAST @@ directive in an assistant message into an action.
export function parseAction(text: string): AgentAction {
  const lines = text.split("\n");
  let directive: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].trim();
    if (l.startsWith("@@")) {
      directive = l;
      break;
    }
  }
  if (!directive) return { kind: "none" };

  if (/^@@DONE\b/i.test(directive)) return { kind: "done" };

  const name = directive.match(/name=("?)([A-Za-z0-9_$.]+)\1/)?.[2];

  if (/^@@COMPILE\b/i.test(directive)) {
    return { kind: "compile", name, source: extractLastSolidity(text) };
  }

  if (/^@@DEPLOY\b/i.test(directive)) {
    let args: unknown[] = [];
    const argsRaw = directive.match(/args=(\[[\s\S]*\])\s*$/)?.[1];
    if (argsRaw) {
      try {
        const parsed = JSON.parse(argsRaw);
        if (Array.isArray(parsed)) args = parsed;
      } catch {
        /* leave args empty; the deploy handler will report a clear error */
      }
    }
    return { kind: "deploy", name, args };
  }

  return { kind: "none" };
}

// --- Tool-result messages fed back to the model as the next user turn --------

function fmtErrors(errors: CompileError[]): string {
  return errors
    .slice(0, 8)
    .map((e) => e.formattedMessage || e.message)
    .join("\n");
}

export function compileOkMessage(
  contractName: string,
  byteLength: number,
  constructorInputs: { name: string; type: string }[],
): string {
  const ctor =
    constructorInputs.length === 0
      ? "none"
      : constructorInputs.map((i) => `${i.type} ${i.name}`).join(", ");
  return `[TOOL RESULT] COMPILE OK. Contract "${contractName}" compiled successfully (${byteLength} bytes of bytecode). Constructor inputs: ${ctor}. If the user asked to deploy, respond with @@DEPLOY name=${contractName} args=[...] providing constructor arguments in order (use "$WALLET" for the user's address). Otherwise summarize and @@DONE.`;
}

export function compileErrorMessage(errors: CompileError[], attemptsLeft: number): string {
  return `[TOOL RESULT] COMPILE FAILED. Solc errors:\n${fmtErrors(errors)}\n\nFix the FULL contract source and respond with @@COMPILE again. Attempts remaining: ${attemptsLeft}.`;
}

export function compileGaveUpMessage(errors: CompileError[]): string {
  return `[TOOL RESULT] COMPILE FAILED and the auto-fix attempt limit is reached. Remaining errors:\n${fmtErrors(errors)}\n\nStop trying to compile. Explain the problem to the user in plain language and @@DONE.`;
}

export function deployOkMessage(
  contractName: string,
  address: string,
  txHash: string,
  block: number,
  network: string,
): string {
  return `[TOOL RESULT] DEPLOY OK. "${contractName}" is live on ${network} at ${address} (tx ${txHash}, block ${block}). Give the user a short summary with the address, then @@DONE.`;
}

export function deployErrorMessage(message: string): string {
  return `[TOOL RESULT] DEPLOY FAILED: ${message}\n\nIf this is a constructor-argument problem, fix the args and @@DEPLOY again. If it needs the user (e.g. connect a wallet, fund gas), explain it and @@DONE.`;
}
