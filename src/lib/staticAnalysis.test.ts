import { describe, expect, test } from "bun:test";
import { runStaticAnalysis } from "./staticAnalysis";

function codes(source: string): string[] {
  return runStaticAnalysis(source, "Test.sol").map((f) => f.code);
}

describe("runStaticAnalysis", () => {
  test("flags an unchecked low-level call (SA005)", () => {
    const src = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract C {
  function withdraw(address to, uint256 amount) external {
    to.call{value: amount}("");
  }
}`;
    expect(codes(src)).toContain("SA005");
  });

  test("does not flag a checked low-level call", () => {
    const src = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract C {
  function withdraw(address to, uint256 amount) external {
    (bool ok, ) = to.call{value: amount}("");
    require(ok, "failed");
  }
}`;
    expect(codes(src)).not.toContain("SA005");
  });

  test("flags a state write after an external call (SA006 — reentrancy pattern)", () => {
    const src = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract C {
  mapping(address => uint256) public balances;
  function withdraw() external {
    (bool ok, ) = msg.sender.call{value: balances[msg.sender]}("");
    require(ok);
    balances[msg.sender] = 0;
  }
}`;
    expect(codes(src)).toContain("SA006");
  });

  test("a clean, well-formed contract produces no findings", () => {
    const src = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;
contract C {
  uint256 public value;
  event ValueSet(uint256 value);
  function setValue(uint256 v) external {
    value = v;
    emit ValueSet(v);
  }
}`;
    expect(codes(src)).toEqual([]);
  });

  test("flags missing SPDX and tx.origin auth", () => {
    const src = `pragma solidity 0.8.20;
contract C {
  address owner;
  function admin() external view returns (bool) {
    return tx.origin == owner;
  }
}`;
    const found = codes(src);
    expect(found).toContain("SA001");
    expect(found).toContain("SA003");
  });
});
