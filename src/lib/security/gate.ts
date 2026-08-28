// Deploy gate for the AI agent's security review.
//
// runStaticAnalysis() classifies findings for the EDITOR's Inspector panel,
// where "severity" means roughly "how loudly should this be shown". That scale
// is wrong for deciding whether to let an autonomous agent put a contract on
// mainnet: reentrancy and tx.origin authentication are only "warning" there,
// while an old-pragma overflow note is "error". Gating on that field directly
// would block a pragma nit and wave through a drainable contract.
//
// So exploitability is mapped explicitly, by check id. The mapping is
// deliberately small and auditable — a reader can see exactly what will and
// will not stop a deploy — and anything unrecognised is treated as advisory
// rather than blocking, so adding a new lint check can never silently start
// blocking every deploy.

import type { AnalysisFinding } from "@/lib/staticAnalysis";

export type RiskLevel = "critical" | "high" | "medium" | "low";

/** Exploitability of each static-analysis check, independent of how the
 *  editor chooses to display it. Only `critical` and `high` block a deploy. */
const RISK_BY_CODE: Record<string, RiskLevel> = {
  // Funds can be drained or the contract bricked by an attacker.
  SA006: "critical", // reentrancy
  SA003: "high", // tx.origin auth — phishable authentication bypass
  SA004: "high", // selfdestruct — contract can be destroyed
  SA005: "high", // unchecked low-level call — silent failure, often fund loss
  SA009: "high", // pre-0.8 arithmetic with no overflow protection

  // Real issues, but not "do not deploy this" on their own.
  SA007: "medium", // precision loss
  SA008: "medium", // missing zero-address check
  SA010: "medium", // unbounded loop — DoS risk at scale
  SA012: "low", // no events
  SA001: "low", // missing SPDX
  SA002: "low", // floating pragma
  SA011: "low", // hardcoded large number
};

/** Unknown checks are advisory. A new lint rule must never start blocking
 *  deploys just by existing — that decision belongs in the table above. */
const DEFAULT_RISK: RiskLevel = "low";

export function riskOf(finding: Pick<AnalysisFinding, "code">): RiskLevel {
  return RISK_BY_CODE[finding.code] ?? DEFAULT_RISK;
}

export function isBlocking(level: RiskLevel): boolean {
  return level === "critical" || level === "high";
}

export interface ReviewResult {
  /** Every finding, annotated with its deploy-gate risk, worst first. */
  findings: Array<AnalysisFinding & { risk: RiskLevel }>;
  /** The subset that must be fixed before deploying. */
  blocking: Array<AnalysisFinding & { risk: RiskLevel }>;
  /** True when nothing blocks a deploy (advisory findings may still exist). */
  passed: boolean;
}

const ORDER: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Annotate and rank raw static-analysis output for the agent's review step. */
export function reviewFindings(findings: AnalysisFinding[]): ReviewResult {
  const annotated = findings
    .map((f) => ({ ...f, risk: riskOf(f) }))
    .sort((a, b) => ORDER[a.risk] - ORDER[b.risk]);
  const blocking = annotated.filter((f) => isBlocking(f.risk));
  return { findings: annotated, blocking, passed: blocking.length === 0 };
}

/** One-line summary for the agent timeline. */
export function summarise(r: ReviewResult): string {
  if (r.findings.length === 0) return "No issues found";
  const counts = r.findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.risk] = (acc[f.risk] ?? 0) + 1;
    return acc;
  }, {});
  return (["critical", "high", "medium", "low"] as const)
    .filter((l) => counts[l])
    .map((l) => `${counts[l]} ${l}`)
    .join(", ");
}

/**
 * Whether a deploy is allowed to proceed.
 *
 * The review pass is bound to the exact bytecode that was reviewed. Comparing
 * bytecode rather than tracking a boolean is what makes the gate hard to fool:
 * recompiling after an edit produces different bytecode, so a pass earned by
 * an earlier version can never authorise the new one. A model that skips
 * @@REVIEW, or claims to have run it, still fails this check.
 */
export function canDeploy(
  reviewedBytecode: string | null,
  currentBytecode: string | null | undefined,
): boolean {
  if (!reviewedBytecode || !currentBytecode) return false;
  return reviewedBytecode === currentBytecode;
}
