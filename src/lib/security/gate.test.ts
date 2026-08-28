import { describe, expect, it } from "bun:test";
import { reviewFindings, riskOf, isBlocking, summarise, canDeploy } from "./gate";
import { runStaticAnalysis } from "@/lib/staticAnalysis";
import type { AnalysisFinding } from "@/lib/staticAnalysis";

const f = (code: string, severity: AnalysisFinding["severity"] = "warning"): AnalysisFinding => ({
  severity,
  code,
  title: code,
  description: "",
  hint: "",
});

describe("risk mapping", () => {
  it("blocks the checks that actually lose funds", () => {
    for (const code of ["SA006", "SA003", "SA004", "SA005", "SA009"]) {
      expect(isBlocking(riskOf({ code }))).toBe(true);
    }
  });

  it("does not block on style or advisory checks", () => {
    for (const code of ["SA001", "SA002", "SA007", "SA008", "SA010", "SA011", "SA012"]) {
      expect(isBlocking(riskOf({ code }))).toBe(false);
    }
  });

  it("ignores the editor's display severity", () => {
    // Reentrancy is only "warning" in the editor but must still block, and a
    // display-"error" must not block unless its code says so.
    expect(isBlocking(riskOf({ code: "SA006" }))).toBe(true);
    expect(isBlocking(riskOf({ code: "SA012" }))).toBe(false);
  });

  it("treats an unknown check as advisory, never blocking", () => {
    // Adding a lint rule must not silently start blocking every deploy.
    expect(riskOf({ code: "SA999" })).toBe("low");
    expect(isBlocking(riskOf({ code: "SA999" }))).toBe(false);
  });
});

describe("reviewFindings", () => {
  it("passes a clean contract", () => {
    const r = reviewFindings([]);
    expect(r.passed).toBe(true);
    expect(r.blocking).toHaveLength(0);
  });

  it("fails and reports only the blocking subset", () => {
    const r = reviewFindings([f("SA001"), f("SA006"), f("SA012")]);
    expect(r.passed).toBe(false);
    expect(r.blocking.map((b) => b.code)).toEqual(["SA006"]);
    expect(r.findings).toHaveLength(3);
  });

  it("orders worst-first", () => {
    const r = reviewFindings([f("SA012"), f("SA003"), f("SA006"), f("SA008")]);
    expect(r.findings.map((x) => x.risk)).toEqual(["critical", "high", "medium", "low"]);
  });

  it("summarises counts by risk", () => {
    expect(summarise(reviewFindings([]))).toBe("No issues found");
    expect(summarise(reviewFindings([f("SA006"), f("SA003"), f("SA001")]))).toBe(
      "1 critical, 1 high, 1 low",
    );
  });
});

describe("end-to-end against the real analyzer", () => {
  it("blocks a genuinely vulnerable contract", () => {
    const vulnerable = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Drainable {
    mapping(address => uint256) public balances;
    function withdraw() external {
        uint256 amount = balances[msg.sender];
        (bool ok, ) = msg.sender.call{value: amount}("");
        balances[msg.sender] = 0;
    }
    function admin() external view returns (bool) { return tx.origin == address(this); }
}`;
    const r = reviewFindings(runStaticAnalysis(vulnerable, "Drainable.sol"));
    expect(r.passed).toBe(false);
    // State written AFTER an external call, plus tx.origin auth.
    expect(r.blocking.length).toBeGreaterThan(0);
  });

  it("passes a well-written contract", () => {
    const safe = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract Counter {
    uint256 private _count;
    event Counted(uint256 value);
    function increment() external {
        _count += 1;
        emit Counted(_count);
    }
    function count() external view returns (uint256) { return _count; }
}`;
    expect(reviewFindings(runStaticAnalysis(safe, "Counter.sol")).passed).toBe(true);
  });
});

describe("canDeploy — the gate the agent cannot talk its way past", () => {
  const BYTECODE = "0x6080604052";

  it("allows a deploy of exactly what was reviewed", () => {
    expect(canDeploy(BYTECODE, BYTECODE)).toBe(true);
  });

  it("refuses when no review has passed", () => {
    expect(canDeploy(null, BYTECODE)).toBe(false);
  });

  it("refuses after a recompile changes the bytecode", () => {
    // The whole point: reviewing one contract must not authorise a different
    // one. An agent that fixes a finding and recompiles has to review again.
    expect(canDeploy(BYTECODE, "0x6080604000")).toBe(false);
  });

  it("refuses when there is nothing to deploy", () => {
    expect(canDeploy(BYTECODE, null)).toBe(false);
    expect(canDeploy(BYTECODE, undefined)).toBe(false);
    expect(canDeploy(null, null)).toBe(false);
  });
});
