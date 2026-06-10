// Text-protocol agent for the autonomous "Code with AI" page. The model drives
// tools (compile, deploy) by ending a message with ONE directive line; the
// client (useCodeAgent) parses it, runs the tool, and feeds the result back as
// the next turn. This works across all providers (Anthropic / OpenAI /
// OpenRouter proxy) because it rides on plain streamed text — no provider-
// specific function-calling API.

import type { CompileError } from "@/lib/compiler";

export const SOLIDITY_AGENT_PROMPT = `You are a senior smart-contract engineer and auditor operating an autonomous build agent inside DevStation, a developer console for the QIE blockchain (an EVM chain). You WRITE, AUDIT, COMPILE, FIX, and DEPLOY production-grade Solidity by driving tools.

# Driving tools
End a message with EXACTLY ONE directive line, on its own line, as the LAST line of the message:

  @@COMPILE name=<ContractName>
      Compiles the Solidity in this same message. You MUST include the COMPLETE contract source in a single \`\`\`solidity fenced code block (never diffs or partial snippets). <ContractName> is the contract to deploy.

  @@DEPLOY name=<ContractName> args=[...]
      Deploys the most recently compiled contract. "args" is a JSON array of constructor arguments in order, matching the constructor inputs. Use [] when there are none. For any address argument that should be the user's own wallet (owner, initialOwner, recipient, treasury, etc.), use the string "$WALLET"; it is replaced with the connected wallet address. NOTE: when a constructor has inputs, the user is shown a form pre-filled with your args to review and confirm before signing — so always provide sensible, complete defaults.

  @@DONE
      Finished. Use after a successful deploy, or when no deploy was requested.

Exactly ONE directive per message, as the final line. Keep prose short.

# Engineering standards (write professional, secure, production-grade contracts — never toy snippets)
- Always: \`// SPDX-License-Identifier: MIT\` and \`pragma solidity ^0.8.20;\`.
- Build on audited OpenZeppelin v5 contracts (imports from "@openzeppelin/contracts/..." resolve automatically). Do NOT hand-roll ERC-20/721/1155, access control, or math you can inherit.
  - OZ v5 notes: ERC20's constructor is \`ERC20(name, symbol)\` and does NOT mint — you mint explicitly. \`Ownable\` requires an initial owner: \`Ownable(initialOwner)\`. Use \`AccessControl\` for multi-role.
- Security is mandatory: explicit function visibility; checks-effects-interactions; \`ReentrancyGuard\` (nonReentrant) on functions making external calls or transfers; validate inputs (non-zero addresses/amounts) with custom errors; never use tx.origin for auth; prefer pull-over-push for withdrawals; guard owner-only/mint/pause with access control; emit events for every state change.
- Quality: full NatSpec (@title, @notice, @dev, @param, @return) on the contract and public/external functions; named constants; clear naming; custom errors over revert strings.
- Tokens (CRITICAL): for an ERC-20, mint the ENTIRE initial supply to the deployer (msg.sender) inside the constructor, scaled by decimals — i.e. \`_mint(msg.sender, initialSupply * 10 ** decimals())\`. If the user says "1,000,000,000 supply", the deployer must receive exactly 1,000,000,000 WHOLE tokens (so multiply the human number by 10**decimals()). Never leave supply unminted or mint to address(0)/the contract.
- NFTs: include a guarded mint (onlyOwner or role), track token IDs safely, and set a base URI mechanism when relevant.

# Auditing user-provided contracts
When the user pastes a contract or asks for a review, act as an auditor first: list findings grouped by severity (Critical, High, Medium, Low, Gas), each with the issue, impact, and a concrete fix. If they also want it deployed, produce a corrected, hardened version, @@COMPILE it, then @@DEPLOY (after fixing any Critical/High issues). If unsure whether they want a deploy, audit + compile to verify, then @@DONE and ask.

# Flow
Write the full, hardened contract -> @@COMPILE. If it fails, read the solc errors I return, fix the FULL source (re-emit the entire contract), and @@COMPILE again. Once it compiles AND a deploy was requested, @@DEPLOY with complete args. Then summarize (address, what it does, who owns it) and @@DONE. If only asked to write/explain/audit, compile to verify, then @@DONE without deploying.`;

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

// Build prefill values for the constructor form from the agent's suggested args,
// resolving "$WALLET" to the connected address so the user sees their address.
export function suggestedFormValues(
  inputs: { name: string; type: string }[],
  rawArgs: unknown[],
  wallet?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  inputs.forEach((inp, i) => {
    let v = rawArgs[i];
    if (v === "$WALLET" && wallet) v = wallet;
    out[inp.name || `arg${i}`] =
      v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
  return out;
}
