// Lightweight static analysis for Solidity source. Regex/pattern based (no AST
// parsing) so it runs fast and identically on client or server. Designed to run
// AFTER a successful compile and surface common security/quality issues in the
// editor's Inspector panel.

export interface AnalysisFinding {
  severity: "error" | "warning" | "info";
  code: string; // unique id e.g. "SA001"
  title: string;
  description: string;
  hint: string;
  line?: number;
  column?: number;
}

export const STATIC_ANALYSIS_CHECK_COUNT = 12;

// Extract each function's body (the `{ ... }` block) via brace counting, so
// inline modifiers like `.call{value: x}(...)` don't truncate the body the way
// a naive `[^}]*}` regex would. Declaration-only functions (ending in `;`) are
// skipped.
function functionBodies(source: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const sig = /function\s+(\w+)[^{;]*\{/g;
  let m: RegExpExecArray | null;
  while ((m = sig.exec(source)) !== null) {
    const name = m[1];
    let depth = 0;
    let j = sig.lastIndex - 1; // position of the opening '{'
    const start = j;
    for (; j < source.length; j++) {
      if (source[j] === "{") depth++;
      else if (source[j] === "}") {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      }
    }
    out.push({ name, body: source.slice(start, j) });
    sig.lastIndex = j; // continue after this body
  }
  return out;
}

export function runStaticAnalysis(source: string, _filename: string): AnalysisFinding[] {
  const findings: AnalysisFinding[] = [];
  const lines = source.split("\n");

  // Line number (1-based) of the first line matching `pattern`.
  function findLine(pattern: RegExp): number | undefined {
    for (let i = 0; i < lines.length; i++) {
      // Reset lastIndex for safety when a global flag is present.
      pattern.lastIndex = 0;
      if (pattern.test(lines[i])) return i + 1;
    }
    return undefined;
  }

  // ─── SA001: Missing SPDX License ───────────────────────────────────────────
  if (!source.includes("SPDX-License-Identifier")) {
    findings.push({
      severity: "warning",
      code: "SA001",
      title: "Missing SPDX License Identifier",
      description: "No SPDX license identifier found in this file.",
      hint: 'Add "// SPDX-License-Identifier: MIT" as the first line of the file.',
    });
  }

  // ─── SA002: Floating Pragma ────────────────────────────────────────────────
  if (/pragma solidity\s+\^/.test(source)) {
    findings.push({
      severity: "info",
      code: "SA002",
      title: "Floating Pragma Version",
      description: 'The pragma uses "^" which allows compilation with any compatible version.',
      hint: 'For production contracts, lock the pragma to an exact version: "pragma solidity 0.8.20;" (no caret).',
      line: findLine(/pragma solidity\s+\^/),
    });
  }

  // ─── SA003: tx.origin for Auth ─────────────────────────────────────────────
  if (/tx\.origin/.test(source)) {
    findings.push({
      severity: "warning",
      code: "SA003",
      title: "Use of tx.origin for Authentication",
      description:
        "tx.origin refers to the original transaction sender and is vulnerable to phishing attacks.",
      hint: "Replace tx.origin with msg.sender for authentication checks. Example: require(msg.sender == owner)",
      line: findLine(/tx\.origin/),
    });
  }

  // ─── SA004: selfdestruct ───────────────────────────────────────────────────
  if (/selfdestruct\s*\(/.test(source)) {
    findings.push({
      severity: "warning",
      code: "SA004",
      title: "Use of selfdestruct",
      description:
        "selfdestruct is deprecated as of EIP-6049 and may behave unexpectedly in future hard forks.",
      hint: "Avoid using selfdestruct in new contracts. Consider a pause/emergency-stop pattern instead.",
      line: findLine(/selfdestruct\s*\(/),
    });
  }

  // ─── SA005: Unchecked Low-Level Call Return Value ──────────────────────────
  // .call{...}( / .send{...}( whose (bool success, ) result is not captured.
  const callMatches = source.match(/\.(call|send)\s*\{[^}]*\}\s*\(/g) ?? [];
  const checkedCount = (source.match(/\(\s*bool\s+\w+\s*,/g) ?? []).length;
  if (callMatches.length > checkedCount) {
    findings.push({
      severity: "warning",
      code: "SA005",
      title: "Unchecked Low-Level Call Return Value",
      description:
        "A .call() or .send() return value may not be checked. Failed calls silently return false.",
      hint:
        "Always check the return value:\n" +
        '  (bool success, ) = addr.call{value: amount}("");\n' +
        '  require(success, "Transfer failed");',
      line: findLine(/\.(call|send)\s*[({]/),
    });
  }

  // ─── SA006: Reentrancy Pattern ─────────────────────────────────────────────
  // External call (.call/.transfer/.send) occurring BEFORE a state assignment
  // within the same function body (simplified Checks-Effects-Interactions check).
  for (const { name: fnName, body } of functionBodies(source)) {
    const call = /\.(call|transfer|send)\s*[({]/.exec(body);
    if (!call) continue;
    // A state-ish assignment: `name = ...` or `name[...] = ...`, excluding
    // ==, <=, >=, != (the negative lookahead rejects a following `=`).
    const assign = /[A-Za-z_]\w*(?:\[[^\]]*\])?\s*=(?![=])/g;
    let m: RegExpExecArray | null;
    let assignAfterCall = false;
    while ((m = assign.exec(body)) !== null) {
      if (m.index > call.index) {
        assignAfterCall = true;
        break;
      }
    }
    if (assignAfterCall) {
      findings.push({
        severity: "warning",
        code: "SA006",
        title: "Possible Reentrancy Vulnerability",
        description: `Function "${fnName}" may make external calls before updating state. This is the classic reentrancy vulnerability pattern.`,
        hint:
          "Follow the Checks-Effects-Interactions pattern:\n" +
          "  1. Perform all checks (require statements)\n" +
          "  2. Update state variables\n" +
          "  3. Make external calls last\n" +
          "Or add OpenZeppelin ReentrancyGuard.",
        line: findLine(new RegExp(`function\\s+${fnName}`)),
      });
      break; // one reentrancy finding per file to limit noise
    }
  }

  // ─── SA007: Division Before Multiplication ─────────────────────────────────
  if (/\([^)]+\/[^)]+\)\s*\*/.test(source)) {
    findings.push({
      severity: "warning",
      code: "SA007",
      title: "Division Before Multiplication (Precision Loss)",
      description:
        "Dividing before multiplying truncates the result. Solidity integer division always rounds down, causing precision loss.",
      hint: "Reorder operations: multiply first, then divide.\n  (a / b) * c  →  (a * c) / b",
      line: findLine(/\([^)]+\/[^)]+\)\s*\*/),
    });
  }

  // ─── SA008: Missing Zero-Address Check ─────────────────────────────────────
  const addressParams = source.match(/function\s+\w+\s*\([^)]*address\s+(\w+)[^)]*\)/g) ?? [];
  for (const param of addressParams) {
    const paramName = /address\s+(\w+)/.exec(param)?.[1];
    if (paramName && !source.includes(`${paramName} != address(0)`)) {
      findings.push({
        severity: "info",
        code: "SA008",
        title: `No Zero-Address Check on "${paramName}"`,
        description: `The address parameter "${paramName}" has no zero-address validation.`,
        hint: `Add at the start of the function:\n  require(${paramName} != address(0), "${paramName} cannot be zero address");`,
      });
      break; // only report once per file to avoid noise
    }
  }

  // ─── SA009: Integer Overflow Risk (pre-0.8) ────────────────────────────────
  const pragmaVersion = /pragma solidity\s+[^0-9]*(\d+\.\d+)/.exec(source);
  if (pragmaVersion) {
    const minor = parseFloat(pragmaVersion[1]);
    if (minor < 0.8 && /[+\-*]/.test(source)) {
      findings.push({
        severity: "error",
        code: "SA009",
        title: "Integer Overflow/Underflow Risk",
        description: "Solidity versions below 0.8.0 do not have built-in overflow protection.",
        hint: "Use OpenZeppelin SafeMath, or upgrade to Solidity 0.8.0+ which has built-in overflow checks.",
      });
    }
  }

  // ─── SA010: Unbounded Loop ─────────────────────────────────────────────────
  if (/for\s*\([^)]*\.length[^)]*\)/.test(source)) {
    findings.push({
      severity: "info",
      code: "SA010",
      title: "Potentially Unbounded Loop",
      description:
        "A loop iterates over an array whose length is not bounded. As the array grows, the function may exceed the block gas limit.",
      hint: "Add a maximum iteration cap, or use pagination patterns for large datasets. Consider off-chain computation.",
      line: findLine(/for\s*\([^)]*\.length/),
    });
  }

  // ─── SA011: Hardcoded Large Number ─────────────────────────────────────────
  if (/==\s*\d{15,}/.test(source)) {
    findings.push({
      severity: "info",
      code: "SA011",
      title: "Hardcoded Large Number",
      description:
        "A hardcoded large number was detected. If this represents an ETH amount, use named units.",
      hint:
        "Use Solidity units for clarity:\n" +
        "  1 ether  (= 1e18 wei)\n" +
        "  1 gwei   (= 1e9 wei)\n" +
        "  100 ether instead of 100000000000000000000",
      line: findLine(/==\s*\d{15,}/),
    });
  }

  // ─── SA012: Missing Event for State Change ─────────────────────────────────
  const hasStateVar = /\w+\s+(?:public|private|internal)\s+\w+/.test(source);
  const hasSetter = /function\s+set\w+/.test(source);
  const hasEvent = /emit\s+\w+/.test(source);
  if (hasStateVar && hasSetter && !hasEvent) {
    findings.push({
      severity: "info",
      code: "SA012",
      title: "No Events Emitted",
      description:
        "This contract has setter functions but no events. Off-chain services cannot track state changes without events.",
      hint:
        "Add events for important state changes:\n" +
        "  event ValueChanged(address indexed by, uint256 newValue);\n" +
        "  emit ValueChanged(msg.sender, newValue);",
    });
  }

  return findings;
}
