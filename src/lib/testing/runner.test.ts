import { describe, expect, it } from "bun:test";
import { runSuite, TEST_OWNER, TEST_OTHER } from "./runner";
import { testSuite } from "./types";
import type { Abi } from "viem";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require("solc");

const SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract Token {
    string public name = "Test";
    uint256 public totalSupply;
    address public owner;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    error NotOwner();
    constructor(address initialOwner, uint256 supply) {
        owner = initialOwner;
        totalSupply = supply;
        balanceOf[initialOwner] = supply;
    }
    function mint(address to, uint256 amount) external {
        if (msg.sender != owner) revert NotOwner();
        balanceOf[to] += amount;
        totalSupply += amount;
    }
    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}`;

function compile() {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Token.sol": { content: SRC } },
        settings: {
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const c = out.contracts["Token.sol"]["Token"];
  return { abi: c.abi as Abi, bytecode: `0x${c.evm.bytecode.object}` as `0x${string}` };
}
const { abi, bytecode } = compile();
const DEPLOY = ["$OWNER", "1000"];

describe("runSuite", () => {
  it("deploys with constructor args and reads state set in the constructor", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          { name: "supply", call: "totalSupply", expect: { equals: "1000" } },
          { name: "owner", call: "owner", expect: { equals: TEST_OWNER } },
          { name: "balance", call: "balanceOf", args: ["$OWNER"], expect: { equals: "1000" } },
        ],
      }),
    });
    expect(r.deployed).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.passed).toBe(3);
  });

  it("detects state changes across calls", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          // `reverts: false` is the "just run it and it must succeed" case.
          { name: "mint", call: "mint", args: ["$OTHER", "5"], expect: { reverts: false } },
          { name: "supply grew", call: "totalSupply", expect: { equals: "1005" } },
          { name: "other credited", call: "balanceOf", args: ["$OTHER"], expect: { equals: "5" } },
        ],
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("enforces access control via $OTHER", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          {
            name: "non-owner cannot mint",
            call: "mint",
            args: ["$OTHER", "1"],
            from: "$OTHER",
            expect: { reverts: true },
          },
        ],
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("matches a revert reason string", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          {
            name: "overdraw",
            call: "transfer",
            args: ["$OTHER", "99999"],
            expect: { reverts: "insufficient balance" },
          },
        ],
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("FAILS when the revert reason does not match", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          {
            name: "wrong reason",
            call: "transfer",
            args: ["$OTHER", "99999"],
            expect: { reverts: "totally different" },
          },
        ],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.outcomes[0].detail).toContain("insufficient balance");
  });

  it("detects emitted events", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          {
            name: "emits Transfer",
            call: "transfer",
            args: ["$OTHER", "1"],
            expect: { emits: "Transfer" },
          },
        ],
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("FAILS a wrong expected value, and says what it got", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [{ name: "bad supply", call: "totalSupply", expect: { equals: "999" } }],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.outcomes[0].detail).toBe("Expected 999 but got 1000.");
  });

  it("FAILS when a call was expected to revert but succeeded", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          {
            name: "owner can mint",
            call: "mint",
            args: ["$OWNER", "1"],
            expect: { reverts: true },
          },
        ],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.outcomes[0].detail).toContain("Expected the call to revert");
  });

  it("reports an unknown function instead of throwing", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [{ name: "nope", call: "doesNotExist", expect: { equals: "1" } }],
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.outcomes[0].detail).toContain("No function");
  });

  it("reports a failed constructor rather than running tests", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: [], // constructor needs two args
        tests: [{ name: "x", call: "totalSupply", expect: { equals: "0" } }],
      }),
    });
    expect(r.deployed).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.deployError).toBeTruthy();
  });

  it("resolves $OWNER / $OTHER inside expected values, not just args", async () => {
    // Regression: a suite asserting an owner address is the natural thing for
    // a model to write, and it used to compare against the literal "$OWNER".
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: DEPLOY,
        tests: [
          { name: "owner placeholder", call: "owner", expect: { equals: "$OWNER" } },
          { name: "other balance", call: "balanceOf", args: ["$OTHER"], expect: { equals: "0" } },
        ],
      }),
    });
    expect(r.outcomes[0].detail ?? "").toBe("");
    expect(r.ok).toBe(true);
  });

  it("accepts $WALLET as an alias for the owner account", async () => {
    // @@DEPLOY uses $WALLET; suites must not need a second vocabulary.
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: ["$WALLET", "1000"],
        tests: [
          { name: "owner via $WALLET", call: "owner", expect: { equals: "$WALLET" } },
          { name: "balance via $WALLET", call: "balanceOf", args: ["$WALLET"], expect: { equals: "1000" } },
        ],
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("gives the two test accounts distinct addresses", () => {
    expect(TEST_OWNER).not.toBe(TEST_OTHER);
  });
});
