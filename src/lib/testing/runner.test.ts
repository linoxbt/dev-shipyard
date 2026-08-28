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

// Node solc as the injected helper compiler. In the app this is the
// in-browser solc worker; the runner does not care which.
const compileHelper = async (source: string) => {
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "Helper.sol": { content: source } },
        settings: {
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const errors = (out.errors ?? [])
    .filter((e: { severity: string }) => e.severity === "error")
    .map((e: { formattedMessage: string }) => e.formattedMessage);
  const contracts: Record<string, { abi: unknown[]; bytecode: `0x${string}` }> = {};
  for (const file of Object.values(out.contracts ?? {}) as Record<string, never>[]) {
    for (const [name, c] of Object.entries(file)) {
      const art = c as { abi: unknown[]; evm: { bytecode: { object: string } } };
      contracts[name] = { abi: art.abi, bytecode: `0x${art.evm.bytecode.object}` };
    }
  }
  return { contracts, errors };
};

const MOCK_ERC20 = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MockERC20 {
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;
  constructor(address to, uint256 amount) { balanceOf[to] = amount; }
  function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
  function transfer(address t, uint256 a) external returns (bool) {
    require(balanceOf[msg.sender] >= a, "bal"); balanceOf[msg.sender] -= a; balanceOf[t] += a; return true; }
  function transferFrom(address f, address t, uint256 a) external returns (bool) {
    require(balanceOf[f] >= a, "bal"); require(allowance[f][msg.sender] >= a, "allow");
    allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true; }
}`;

// A vault that PULLS tokens — the exact shape that could not be tested before,
// because nothing existed at the token address inside the isolated EVM.
const VAULT_SRC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
interface IERC20 { function transferFrom(address f, address t, uint256 a) external returns (bool); }
contract Vault {
  IERC20 public immutable token; address public owner;
  mapping(address => uint256) public deposited;
  event Deposited(address indexed who, uint256 amount);
  error NotOwner(); error ZeroAmount();
  constructor(address token_, address owner_) { token = IERC20(token_); owner = owner_; }
  function deposit(address from, uint256 amount) external {
    if (msg.sender != owner) revert NotOwner();
    if (amount == 0) revert ZeroAmount();
    deposited[from] += amount;
    emit Deposited(from, amount);
    require(token.transferFrom(from, address(this), amount), "pull failed");
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
          {
            name: "balance via $WALLET",
            call: "balanceOf",
            args: ["$WALLET"],
            expect: { equals: "1000" },
          },
        ],
      }),
    });
    expect(r.ok).toBe(true);
  });

  it("tests a contract with an EXTERNAL TOKEN DEPENDENCY via a helper", async () => {
    // Previously impossible: deposit() calls transferFrom on a token that did
    // not exist in the isolated EVM, so only the pre-call reverts were testable.
    const vault = (() => {
      const out = JSON.parse(
        solc.compile(
          JSON.stringify({
            language: "Solidity",
            sources: { "Vault.sol": { content: VAULT_SRC } },
            settings: {
              evmVersion: "shanghai",
              outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
            },
          }),
        ),
      );
      const c = out.contracts["Vault.sol"]["Vault"];
      return { abi: c.abi as Abi, bytecode: `0x${c.evm.bytecode.object}` as `0x${string}` };
    })();

    const r = await runSuite({
      abi: vault.abi,
      bytecode: vault.bytecode,
      compileHelper,
      suite: testSuite.parse({
        deploy: [
          { as: "$TOKEN", solidity: MOCK_ERC20, contract: "MockERC20", args: ["$WALLET", "1000"] },
        ],
        deployArgs: ["$TOKEN", "$WALLET"],
        tests: [
          { name: "vault points at the helper token", call: "token", expect: { equals: "$TOKEN" } },
          {
            name: "non-owner cannot deposit",
            call: "deposit",
            args: ["$WALLET", "1"],
            from: "$OTHER",
            expect: { reverts: true },
          },
          {
            name: "zero amount rejected",
            call: "deposit",
            args: ["$WALLET", "0"],
            expect: { reverts: true },
          },
          // The funded happy path — the half that used to be untestable.
          {
            name: "deposit fails without approval",
            call: "deposit",
            args: ["$WALLET", "100"],
            expect: { reverts: "allow" },
          },
        ],
      }),
    });
    expect(r.deployed).toBe(true);
    expect(r.helpers?.$TOKEN).toMatch(/^0x[0-9a-f]{40}$/i);
    for (const o of r.outcomes) expect(`${o.name}: ${o.passed}`).toBe(`${o.name}: true`);
    expect(r.ok).toBe(true);
  });

  it("reports a helper that fails to compile, instead of throwing", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      compileHelper,
      suite: testSuite.parse({
        deploy: [{ as: "$BAD", solidity: "contract Nope { this is not solidity }" }],
        deployArgs: DEPLOY,
        tests: [{ name: "x", call: "owner", expect: { equals: "$OWNER" } }],
      }),
    });
    expect(r.deployed).toBe(false);
    expect(r.deployError).toContain("$BAD");
  });

  it("explains when a helper is declared but no compiler was supplied", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deploy: [{ as: "$TOKEN", solidity: MOCK_ERC20 }],
        deployArgs: DEPLOY,
        tests: [{ name: "x", call: "owner", expect: { equals: "$OWNER" } }],
      }),
    });
    expect(r.deployed).toBe(false);
    expect(r.deployError).toContain("no compiler");
  });

  it("REFUSES a helper that claims a reserved placeholder", () => {
    // A helper binding $WALLET silently repoints "the deployer" at a contract,
    // so an ownership assertion passes while proving nothing.
    for (const name of ["$WALLET", "$OWNER", "$OTHER"]) {
      const r = testSuite.safeParse({
        deploy: [{ as: name, solidity: "contract A {}" }],
        deployArgs: [],
        tests: [{ name: "x", call: "owner", expect: { equals: "1" } }],
      });
      expect(`${name}: ${r.success}`).toBe(`${name}: false`);
    }
  });

  it("REFUSES two helpers claiming the same placeholder", () => {
    const r = testSuite.safeParse({
      deploy: [
        { as: "$T", solidity: "contract A {}" },
        { as: "$T", solidity: "contract B {}" },
      ],
      deployArgs: [],
      tests: [{ name: "x", call: "owner", expect: { equals: "1" } }],
    });
    expect(r.success).toBe(false);
  });

  it("caps how much compilation one suite can demand", () => {
    const many = testSuite.safeParse({
      deploy: Array.from({ length: 6 }, (_, i) => ({ as: `$H${i}`, solidity: "contract A {}" })),
      deployArgs: [],
      tests: [{ name: "x", call: "owner", expect: { equals: "1" } }],
    });
    expect(many.success).toBe(false);
    const huge = testSuite.safeParse({
      deploy: [{ as: "$BIG", solidity: "x".repeat(30_000) }],
      deployArgs: [],
      tests: [{ name: "x", call: "owner", expect: { equals: "1" } }],
    });
    expect(huge.success).toBe(false);
  });

  it("names an unknown placeholder instead of leaking a viem error", async () => {
    const r = await runSuite({
      abi,
      bytecode,
      suite: testSuite.parse({
        deployArgs: ["$NOPE", "$WALLET"],
        tests: [{ name: "x", call: "owner", expect: { equals: "$WALLET" } }],
      }),
    });
    expect(r.deployed).toBe(false);
    expect(r.deployError).toContain("$NOPE");
    expect(r.deployError).toContain("$WALLET");
    expect(r.deployError).not.toContain("viem@");
  });

  it("gives the chain a realistic clock, and warpSeconds advances it", async () => {
    // block.timestamp used to be 0, which made every cliff, vesting schedule
    // and deadline behave as though no time had passed — tests passed or
    // failed for reasons unrelated to the contract.
    const clock = (() => {
      const out = JSON.parse(
        solc.compile(
          JSON.stringify({
            language: "Solidity",
            sources: {
              "C.sol": {
                content: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract C {
  uint256 public immutable start;
  constructor(){ start = block.timestamp; }
  function elapsed() external view returns (uint256) { return block.timestamp - start; }
  function nonZero() external view returns (bool) { return block.timestamp > 1600000000; }
}`,
              },
            },
            settings: {
              evmVersion: "shanghai",
              outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
            },
          }),
        ),
      );
      const c = out.contracts["C.sol"]["C"];
      return { abi: c.abi as Abi, bytecode: `0x${c.evm.bytecode.object}` as `0x${string}` };
    })();

    const r = await runSuite({
      abi: clock.abi,
      bytecode: clock.bytecode,
      suite: testSuite.parse({
        deployArgs: [],
        tests: [
          { name: "clock is a real timestamp", call: "nonZero", expect: { equals: "true" } },
          { name: "no time passed yet", call: "elapsed", expect: { equals: "0" } },
          {
            name: "a year passes",
            call: "elapsed",
            warpSeconds: 31536000,
            expect: { equals: "31536000" },
          },
          {
            name: "then a day",
            call: "elapsed",
            warpSeconds: 86400,
            expect: { equals: "31622400" },
          },
        ],
      }),
    });
    for (const o of r.outcomes) expect(`${o.name}: ${o.passed}`).toBe(`${o.name}: true`);
  });

  it("gives the two test accounts distinct addresses", () => {
    expect(TEST_OWNER).not.toBe(TEST_OTHER);
  });
});
