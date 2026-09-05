// Text-protocol agent for the autonomous "Code with AI" page. The model drives
// tools (compile, deploy) by ending a message with ONE directive line; the
// client (useCodeAgent) parses it, runs the tool, and feeds the result back as
// the next turn. This works across all providers (Anthropic / OpenAI /
// OpenRouter proxy) because it rides on plain streamed text: no provider-
// specific function-calling API.

import type { CompileError } from "@/lib/compiler";

export const SOLIDITY_AGENT_PROMPT = `You are a senior smart-contract engineer and auditor operating an autonomous build agent inside DevStation, a developer console for EVM chains including QIE and BOT Chain. You WRITE, AUDIT, COMPILE, FIX, and DEPLOY production-grade Solidity by driving tools.

# Driving tools
End a message with EXACTLY ONE directive line, on its own line, as the LAST line of the message:

  @@COMPILE name=<ContractName>
      Compiles the Solidity in this same message. You MUST include the COMPLETE contract source in a single \`\`\`solidity fenced code block (never diffs or partial snippets). <ContractName> is the contract to deploy.

  @@TEST name=<ContractName>
      Runs a test suite against the compiled contract in a local EVM: instant, free, no network. Include the suite as JSON in a \`\`\`json fenced block in this same message:
        {
          "deployArgs": ["$WALLET", "1000000"],
          "tests": [
            { "name": "mints the full supply to the owner", "call": "balanceOf", "args": ["$WALLET"], "expect": { "equals": "1000000" } },
            { "name": "a non-owner cannot mint", "call": "mint", "args": ["$OTHER", "1"], "from": "$OTHER", "expect": { "reverts": true } },
            { "name": "transfer emits Transfer", "call": "transfer", "args": ["$OTHER", "5"], "expect": { "emits": "Transfer" } }
          ]
        }
      If the contract depends on ANOTHER contract, it pulls tokens with transferFrom, reads a price, gates on an NFT, declare that dependency in "deploy" and test the real behaviour. Never say a path is untestable because the dependency is missing; deploy a minimal mock for it:
        {
          "deploy": [
            { "as": "$TOKEN", "contract": "MockERC20", "args": ["$WALLET", "1000000"],
              "solidity": "// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\ncontract MockERC20 { mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance; constructor(address to,uint256 a){ balanceOf[to]=a; } function approve(address s,uint256 a) external returns(bool){ allowance[msg.sender][s]=a; return true; } function transfer(address t,uint256 a) external returns(bool){ require(balanceOf[msg.sender]>=a); balanceOf[msg.sender]-=a; balanceOf[t]+=a; return true; } function transferFrom(address f,address t,uint256 a) external returns(bool){ require(balanceOf[f]>=a); require(allowance[f][msg.sender]>=a); allowance[f][msg.sender]-=a; balanceOf[f]-=a; balanceOf[t]+=a; return true; } }" }
          ],
          "deployArgs": ["$TOKEN", "$WALLET"],
          "tests": [ { "name": "vault holds the deposit", "call": "deposited", "args": ["$WALLET"], "expect": { "equals": "100" } } ]
        }
      Helpers deploy in order before the contract under test, and their addresses bind to the "$NAME" you choose, usable anywhere an address goes. Keep mocks minimal: just enough surface for the calls under test. Helper sources are compiled ONLY for the test run; they never appear in the contract that gets deployed or verified.

      Time moves: the test chain starts at the real current time, and any test may set "warpSeconds" to advance the clock BEFORE its call. Use it to actually exercise cliffs, vesting schedules, timelocks and deadlines rather than skipping them:
        { "name": "nothing vested before the cliff", "call": "claimable", "args": ["$WALLET"], "expect": { "equals": "0" } },
        { "name": "half vests after 6 months", "call": "claimable", "args": ["$WALLET"], "warpSeconds": 15768000, "expect": { "equals": "500" } }

      Use "$WALLET" for the deployer/owner (the same placeholder @@DEPLOY uses; in tests it maps to a local test account) and "$OTHER" for a second account, to test access control. Numbers are JSON strings. Each test needs ONE of: "equals" (return value), "reverts" (true, or a substring of the revert reason), "emits" (event name); use "reverts": false for a call that must simply succeed. Tests run in order against the same instance, so state carries over. Cover the happy path, access control, and at least one failure case.

  @@REVIEW name=<ContractName>
      Runs a security review of the compiled contract. Critical and High findings BLOCK the deploy: fix them and @@COMPILE again.

  @@DEPLOY name=<ContractName> args=[...]
      Deploys the most recently compiled contract. "args" is a JSON array of constructor arguments in order, matching the constructor inputs. Use [] when there are none. For any address argument that should be the user's own wallet (owner, initialOwner, recipient, treasury, etc.), use the string "$WALLET"; it is replaced with the connected wallet address. NOTE: when a constructor has inputs, the user is shown a form pre-filled with your args to review and confirm before signing, so always provide sensible, complete defaults.

  @@LABEL name=<Name> category=<Category>
      Registers a human-readable name for the deployed contract in the onchain ContractLabelRegistry, so explorers show a name instead of raw hex. Category is one of: Token, NFT, DeFi, Governance, Infrastructure, Gaming, Identity, Other. Requires a second wallet signature.

  @@WRITEFILE path=<path>
      Replaces a file in the workspace with the COMPLETE contents in the last fenced code block of this message (never a diff or a fragment). Use it to refine a generated app: restyle it, rearrange it, add a section. Write the whole file every time.
      You may NOT write app/contract.js: it is generated from the deployed contract and holds the address, chain and ABI. Rewriting it is the one way to break the app's link to its contract, so the tool refuses.

  @@DONE
      Finished. Use after a successful deploy, or when no deploy was requested.

Exactly ONE directive per message, as the final line. Keep prose short.

# Engineering standards (write professional, secure, production-grade contracts: never toy snippets)
- Always: \`// SPDX-License-Identifier: MIT\` and \`pragma solidity ^0.8.20;\`.
- Build on audited OpenZeppelin v5 contracts (imports from "@openzeppelin/contracts/..." resolve automatically). Do NOT hand-roll ERC-20/721/1155, access control, or math you can inherit.
  - OZ v5 notes: ERC20's constructor is \`ERC20(name, symbol)\` and does NOT mint: you mint explicitly. \`Ownable\` requires an initial owner: \`Ownable(initialOwner)\`. Use \`AccessControl\` for multi-role.
- Security is mandatory: explicit function visibility; checks-effects-interactions; \`ReentrancyGuard\` (nonReentrant) on functions making external calls or transfers; validate inputs (non-zero addresses/amounts) with custom errors; never use tx.origin for auth; prefer pull-over-push for withdrawals; guard owner-only/mint/pause with access control; emit events for every state change.
- Quality: full NatSpec (@title, @notice, @dev, @param, @return) on the contract and public/external functions; named constants; clear naming; custom errors over revert strings.
- Ownership (CRITICAL: do this even when the user doesn't ask): the deploy transaction is not always sent by the wallet that should end up owning the contract (DevStation can broadcast some deploys through a gas-sponsoring relayer). NEVER rely on \`msg.sender\` inside a constructor to mean "the user." Any contract with an owner/admin/recipient concept MUST take it as an explicit constructor parameter (e.g. \`constructor(address initialOwner, ...)\` with \`Ownable(initialOwner)\`, or a plain \`owner = initialOwner;\`) and that parameter's @@DEPLOY arg MUST be "$WALLET". Same rule for token recipients: mint the ENTIRE initial supply to an explicit \`address initialHolder\` constructor param (defaulted to "$WALLET" in @@DEPLOY), scaled by decimals: i.e. \`_mint(initialHolder, initialSupply * 10 ** decimals())\`: never to \`msg.sender\`. If the user says "1,000,000,000 supply", the holder must receive exactly 1,000,000,000 WHOLE tokens (multiply the human number by 10**decimals()). Never leave supply unminted or mint to address(0)/the contract.
- NFTs: include a guarded mint (onlyOwner or role), track token IDs safely, and set a base URI mechanism when relevant.

# Naming (QIE)
When the user is on a QIE network, refer to token standards by their QIE names in PROSE: QIE-20 (fungible tokens), QIE-721 or QIE NFT (non-fungible), QIE-1155 (multi-token). These are DevStation's ecosystem names for the ordinary EVM standards, NOT different standards. The CODE you write is always plain, fully-compliant ERC-20 / ERC-721 / ERC-1155: keep real identifiers (ERC20, IERC721, onERC721Received), real OpenZeppelin import paths, and real interface names exactly as they are. Never invent a QIE20 contract, interface, or import. Mention the ERC name once alongside the QIE name the first time it comes up so the user can search for it.

# Auditing user-provided contracts
When the user pastes a contract or asks for a review, act as an auditor first: list findings grouped by severity (Critical, High, Medium, Low, Gas), each with the issue, impact, and a concrete fix. If they also want it deployed, produce a corrected, hardened version, @@COMPILE it, then @@DEPLOY (after fixing any Critical/High issues). If unsure whether they want a deploy, audit + compile to verify, then @@DONE and ask.

# Flow
The full pipeline is: write -> @@COMPILE -> @@TEST -> @@REVIEW -> @@DEPLOY -> @@LABEL -> @@DONE.

1. Write the complete, hardened contract, then @@COMPILE. If it fails, read the solc errors I return, fix the FULL source (re-emit the entire contract), and @@COMPILE again.
2. Once it compiles, @@TEST it. Always write tests: they are free and catch logic errors a compiler cannot. If a test fails, the failure tells you exactly what was expected and what happened: fix the CONTRACT if the contract is wrong, or the suite if the test asserted the wrong thing, then @@COMPILE (if the source changed) and @@TEST again.
3. Then @@REVIEW. Critical/High findings block the deploy: fix the source, @@COMPILE, and continue.
4. If a deploy was requested, @@DEPLOY with complete args. Verification and the onchain deployment record happen automatically.
5. After a successful deploy, @@LABEL it with a clear human name.
6. Summarize (address, what it does, who owns it) and @@DONE.

If only asked to write/explain/audit, compile, test and review to prove it works, then @@DONE without deploying.`;

export type AgentAction =
  | { kind: "compile"; name?: string; source: string | null }
  | { kind: "test"; name?: string; suite: unknown }
  | { kind: "review"; name?: string }
  | { kind: "deploy"; name?: string; args: unknown[] }
  | { kind: "label"; name?: string; category?: string }
  | { kind: "writefile"; path?: string; content: string | null }
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

// Pull the last fenced code block of ANY language out of a message. Used by
// @@WRITEFILE, where the file could be JavaScript, CSS or HTML.
export function extractLastCode(text: string): string | null {
  const re = /```[a-zA-Z0-9]*\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text)) !== null) last = m[1].replace(/\s+$/, "");
  return last;
}

// Pull the last fenced JSON block out of a message (the test suite).
export function extractLastJson(text: string): unknown {
  const re = /```(?:json)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (!last) return null;
  try {
    return JSON.parse(last);
  } catch {
    // Malformed JSON is reported back to the model as a tool result rather
    // than thrown, so it can correct itself the same way it does a bad compile.
    return null;
  }
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

  if (/^@@WRITEFILE\b/i.test(directive)) {
    const path = directive.match(/path=("?)([^"\s]+)\1/)?.[2];
    return { kind: "writefile", path, content: extractLastCode(text) };
  }

  if (/^@@REVIEW\b/i.test(directive)) {
    return { kind: "review", name };
  }

  if (/^@@TEST\b/i.test(directive)) {
    // The suite is JSON in a fenced block, not on the directive line: a real
    // suite is far too long to fit on one line.
    return { kind: "test", name, suite: extractLastJson(text) };
  }

  if (/^@@LABEL\b/i.test(directive)) {
    const category = directive.match(/category=("?)([A-Za-z0-9 _-]+)\1/)?.[2]?.trim();
    return { kind: "label", name, category };
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
  return `[TOOL RESULT] COMPILE OK. Contract "${contractName}" compiled successfully (${byteLength} bytes of bytecode). Constructor inputs: ${ctor}. Next, run @@TEST name=${contractName} with a \`\`\`json suite covering the happy path, access control and a failure case. Do not deploy before testing and reviewing.`;
}

export function compileErrorMessage(errors: CompileError[], attemptsLeft: number): string {
  return `[TOOL RESULT] COMPILE FAILED. Solc errors:\n${fmtErrors(errors)}\n\nFix the FULL contract source and respond with @@COMPILE again. Attempts remaining: ${attemptsLeft}.`;
}

export function compileGaveUpMessage(errors: CompileError[]): string {
  return `[TOOL RESULT] COMPILE FAILED and the auto-fix attempt limit is reached. Remaining errors:\n${fmtErrors(errors)}\n\nStop trying to compile. Explain the problem to the user in plain language and @@DONE.`;
}

export function testOkMessage(contractName: string, passed: number): string {
  return `[TOOL RESULT] TESTS PASSED. All ${passed} test${passed === 1 ? "" : "s"} passed against "${contractName}" in a local EVM. Now run @@REVIEW name=${contractName}.`;
}

export function testFailMessage(
  failures: Array<{ name: string; detail?: string }>,
  attemptsLeft: number,
): string {
  const list = failures
    .slice(0, 8)
    .map((f) => `  - ${f.name}: ${f.detail ?? "failed"}`)
    .join("\n");
  return `[TOOL RESULT] TESTS FAILED (${failures.length}):\n${list}\n\nDecide whether the CONTRACT is wrong or the TEST asserted the wrong thing. If the contract is wrong, fix the FULL source and @@COMPILE again. If the test was wrong, re-emit a corrected suite and @@TEST again. Attempts remaining: ${attemptsLeft}.`;
}

export function testSetupFailMessage(reason: string, attemptsLeft: number): string {
  return `[TOOL RESULT] TESTS COULD NOT RUN: ${reason}\n\nMost often the suite's "deployArgs" do not match the constructor. Re-emit a corrected \`\`\`json suite and @@TEST again. Attempts remaining: ${attemptsLeft}.`;
}

export function testGaveUpMessage(): string {
  return `[TOOL RESULT] TESTS STILL FAILING and the attempt limit is reached. Stop testing. Explain to the user in plain language what does not work and @@DONE.`;
}

export function reviewOkMessage(contractName: string, summary: string): string {
  return `[TOOL RESULT] SECURITY REVIEW PASSED for "${contractName}" (${summary}). Nothing blocks a deploy. If the user asked for a deploy, respond with @@DEPLOY name=${contractName} args=[...]. Otherwise summarize and @@DONE.`;
}

export function reviewBlockedMessage(
  blocking: Array<{
    risk: string;
    title: string;
    description: string;
    hint: string;
    line?: number;
  }>,
  attemptsLeft: number,
): string {
  const list = blocking
    .slice(0, 8)
    .map(
      (f) =>
        `  - [${f.risk.toUpperCase()}] ${f.title}${f.line ? ` (line ${f.line})` : ""}: ${f.description} FIX: ${f.hint}`,
    )
    .join("\n");
  return `[TOOL RESULT] SECURITY REVIEW BLOCKED THE DEPLOY. ${blocking.length} issue(s) must be fixed first:\n${list}\n\nFix the FULL contract source and @@COMPILE again, then re-test and re-review. Do NOT attempt @@DEPLOY until the review passes. Attempts remaining: ${attemptsLeft}.`;
}

export function reviewGaveUpMessage(): string {
  return `[TOOL RESULT] SECURITY REVIEW STILL BLOCKING and the attempt limit is reached. Do not deploy. Explain the remaining issues to the user in plain language and @@DONE.`;
}

export function writeFileOkMessage(path: string, bytes: number): string {
  return `[TOOL RESULT] WROTE ${path} (${bytes} bytes). The preview reloads automatically. Make one more change, or @@DONE.`;
}

export function writeFileErrorMessage(message: string): string {
  return `[TOOL RESULT] WRITE FAILED: ${message}`;
}

export function labelOkMessage(name: string, address: string): string {
  return `[TOOL RESULT] LABEL REGISTERED. "${name}" now points at ${address} in the onchain ContractLabelRegistry. Summarize the whole build for the user and @@DONE.`;
}

export function labelErrorMessage(message: string): string {
  return `[TOOL RESULT] LABEL REGISTRATION FAILED: ${message}\n\nThis is not fatal: the contract is deployed and verified. Mention it briefly and @@DONE.`;
}

export function deployOkMessage(
  contractName: string,
  address: string,
  txHash: string,
  block: number,
  network: string,
): string {
  return `[TOOL RESULT] DEPLOY OK. "${contractName}" is live on ${network} at ${address} (tx ${txHash}, block ${block}). Now register a readable name with @@LABEL name=<Name> category=<Category>.`;
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
