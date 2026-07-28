// Post-Condition Coverage Auditor — DevStation for Stacks' differentiator.
//
// Stacks post-conditions are asset-transfer guardrails the CALLER attaches to a
// transaction; the #1 real-world mistake is a `contract-call` that moves an
// asset with no matching post-condition (or postConditionMode = "allow" with
// none declared), letting a malicious/buggy contract move more than intended.
//
// A full analysis would use Clarinet's own `clarinet check --output-json` AST.
// That toolchain can't run in the browser, so this engine is a deliberately
// NARROW heuristic Clarity walker: it finds the asset-transfer paths in every
// public function and reports whether declared post-conditions cover them. It
// flags external `contract-call?` as `unknown-risk` rather than guessing — the
// audit stays honest about what it can and can't prove. Single source of truth
// for both the editor diagnostics and the explorer coverage badge.

export type AssetType = "stx" | "ft" | "nft" | "external";

export interface TransferPath {
  functionName: string;
  assetType: AssetType;
  /** The asset/contract identifier when resolvable (e.g. token name / callee). */
  asset?: string;
  /** Heuristically, most transfers depend on function args (amount/recipient). */
  conditionalOnArgs: boolean;
}

export type Coverage =
  | "covered"
  | "uncovered"
  | "mode-allow-no-conditions"
  | "amount-mismatch"
  | "unknown-risk";

export interface CoverageDetail {
  functionName: string;
  assetType: AssetType;
  status: "covered" | "uncovered" | "unknown-risk";
  note: string;
}

export interface AuditResult {
  contractId?: string;
  timestamp: string;
  transferPaths: TransferPath[];
  coverage: Coverage;
  details: CoverageDetail[];
}

// Walk each `define-public` body for asset-moving forms. Each transfer is
// attributed to the nearest preceding public function.
export function auditContract(source: string): TransferPath[] {
  const fnRe = /\(define-public\s+\(([a-z0-9!?*+._<>=/-]+)/g;
  const fns: Array<{ name: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = fnRe.exec(source))) fns.push({ name: m[1], index: m.index });

  const fnAt = (idx: number): string => {
    let name = "top-level";
    for (const f of fns) {
      if (f.index <= idx) name = f.name;
      else break;
    }
    return name;
  };

  const paths: TransferPath[] = [];
  const scan = (pattern: RegExp, assetType: AssetType) => {
    const re = new RegExp(pattern.source, "g");
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(source))) {
      // Extract the token/asset symbol that usually follows the form.
      const after = source.slice(mm.index, mm.index + 80);
      const sym = after.match(/\?\s+([a-z0-9.'-]+)/i);
      paths.push({
        functionName: fnAt(mm.index),
        assetType,
        asset: assetType === "external" ? undefined : sym?.[1],
        conditionalOnArgs: true,
      });
    }
  };
  scan(/\(stx-transfer\?/, "stx");
  scan(/\(ft-transfer\?/, "ft");
  scan(/\(nft-transfer\?/, "nft");
  scan(/\(contract-call\?/, "external");
  return paths;
}

export interface DiffOptions {
  /** Transaction / call post-condition mode. */
  postConditionMode: "deny" | "allow";
  /** How many post-conditions the caller declared. */
  declaredCount: number;
}

// Classify each transfer path against the declared post-conditions. This is the
// function BOTH the editor diagnostics and the explorer badge call.
export function diffPostConditions(paths: TransferPath[], opts: DiffOptions): AuditResult {
  const { postConditionMode, declaredCount } = opts;

  const details: CoverageDetail[] = paths.map((p) => {
    if (p.assetType === "external") {
      return {
        functionName: p.functionName,
        assetType: p.assetType,
        status: "unknown-risk",
        note: "External contract-call? moves assets via another contract — declare a post-condition for what it should move, and verify the callee.",
      };
    }
    if (postConditionMode === "allow" && declaredCount === 0) {
      return {
        functionName: p.functionName,
        assetType: p.assetType,
        status: "uncovered",
        note: "postConditionMode = allow with zero post-conditions: any asset can move unchecked.",
      };
    }
    if (declaredCount >= 1) {
      return {
        functionName: p.functionName,
        assetType: p.assetType,
        status: "covered",
        note: "A post-condition is declared — confirm principal, asset, and amount match this transfer.",
      };
    }
    return {
      functionName: p.functionName,
      assetType: p.assetType,
      status: "uncovered",
      note: "No post-condition declared for this transfer path.",
    };
  });

  let coverage: Coverage;
  if (postConditionMode === "allow" && declaredCount === 0 && paths.length > 0) {
    coverage = "mode-allow-no-conditions";
  } else if (details.some((d) => d.status === "uncovered")) {
    coverage = "uncovered";
  } else if (details.some((d) => d.status === "unknown-risk")) {
    coverage = "unknown-risk";
  } else {
    coverage = "covered";
  }

  return { timestamp: new Date().toISOString(), transferPaths: paths, coverage, details };
}

// Convenience: audit source + declared post-condition context in one call.
export function auditSource(
  source: string,
  opts: DiffOptions & { contractId?: string },
): AuditResult {
  const paths = auditContract(source);
  const res = diffPostConditions(paths, opts);
  return { ...res, contractId: opts.contractId };
}

export function coverageLabel(c: Coverage): { text: string; tone: "good" | "warn" | "bad" } {
  switch (c) {
    case "covered":
      return { text: "Covered", tone: "good" };
    case "unknown-risk":
      return { text: "Unknown risk", tone: "warn" };
    case "amount-mismatch":
      return { text: "Amount mismatch", tone: "warn" };
    case "mode-allow-no-conditions":
      return { text: "Allow-mode, no conditions", tone: "bad" };
    case "uncovered":
    default:
      return { text: "Uncovered", tone: "bad" };
  }
}
