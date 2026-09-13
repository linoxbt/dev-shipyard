import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runSuite } from "@/lib/testing/runner";
import type { SuiteResult } from "@/lib/testing/types";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const solc = require("solc");

// DevStationMarketplace in the same in-process EVM the agent uses, pinned to
// Shanghai: the fork QIE runs. Every rule that moves money is asserted through
// `pending`, the only place value accumulates before it can be withdrawn.

const artifact = JSON.parse(readFileSync("contracts/out/DevStationMarketplace.json", "utf8")) as {
  abi: unknown[];
  bytecode: `0x${string}`;
};

const TREASURY = "0x00000000000000000000000000000000000000fe";
const NATIVE = "0x0000000000000000000000000000000000000000";
const HASH = `0x${"ab".repeat(32)}`;
const PRICE = "1000000000000000000"; // 1 QIE
const USD = "2500000"; // 2.5 QUSDC, 6 decimals

// A stand-in for QUSDC. transferFrom checks balance only: the harness can call
// nothing but the contract under test, so a buyer has no way to approve, and
// allowance is the token's rule to enforce, not the marketplace's.
const MOCK_QUSDC = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
contract MockQUSDC {
  uint8 public constant decimals = 6;
  mapping(address => uint256) public balanceOf;
  constructor(address a, address b) { balanceOf[a] = 1e12; balanceOf[b] = 1e12; }
  function transferFrom(address f, address t, uint256 v) external returns (bool) {
    require(balanceOf[f] >= v, "balance"); balanceOf[f] -= v; balanceOf[t] += v; return true;
  }
  function transfer(address t, uint256 v) external returns (bool) {
    require(balanceOf[msg.sender] >= v, "balance"); balanceOf[msg.sender] -= v; balanceOf[t] += v; return true;
  }
}`;

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

type Case = Record<string, unknown>;

async function run(tests: Case[], opts: { qusdc?: boolean } = {}): Promise<SuiteResult> {
  const withToken = opts.qusdc !== false;
  return runSuite({
    abi: artifact.abi as never,
    bytecode: artifact.bytecode,
    compileHelper,
    suite: {
      deploy: withToken ? [{ as: "$TOKEN", solidity: MOCK_QUSDC, args: ["$OWNER", "$OTHER"] }] : [],
      deployArgs: [TREASURY, withToken ? "$TOKEN" : NATIVE],
      tests,
    } as never,
  });
}

function failures(r: SuiteResult): string[] {
  if (!r.deployed) return [`deploy: ${r.deployError}`];
  return r.outcomes.filter((o) => !o.passed).map((o) => `${o.name}: ${o.detail ?? ""}`);
}

/** kind, currency, model, price. Creator is always $OWNER, the default caller. */
function publish(kind: number, currency: number, model: number, price: string): Case {
  return {
    name: `publish kind ${kind} currency ${currency} model ${model}`,
    call: "publish",
    args: [String(kind), String(currency), String(model), price, "Vault", "A vault", "{}", HASH],
    expect: { emits: "ListingPublished" },
  };
}

const pending = (token: string, who: string, equals: string): Case => ({
  name: `pending ${token} ${who} is ${equals}`,
  call: "pending",
  args: [token, who],
  expect: { equals },
});

describe("DevStationMarketplace: one-time purchases in QIE", () => {
  it("sells once, splits 95/5, and grants access", async () => {
    const r = await run([
      publish(0, 0, 0, PRICE),
      {
        name: "no access before paying",
        call: "hasAccess",
        args: ["0", "$OTHER"],
        expect: { equals: false },
      },
      {
        name: "creator always has access",
        call: "hasAccess",
        args: ["0", "$OWNER"],
        expect: { equals: true },
      },
      {
        name: "underpaying reverts",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: "1",
        expect: { reverts: "Send exactly the price" },
      },
      {
        name: "buy",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { emits: "Purchased" },
      },
      pending(NATIVE, TREASURY, "50000000000000000"),
      pending(NATIVE, "$OWNER", "950000000000000000"),
      {
        name: "buyer has access",
        call: "hasAccess",
        args: ["0", "$OTHER"],
        expect: { equals: true },
      },
      {
        name: "second purchase refused",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { reverts: "Already purchased" },
      },
      {
        name: "creator cannot buy their own",
        call: "buy",
        args: ["0"],
        value: PRICE,
        expect: { reverts: "You created this listing" },
      },
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("withdraws, zeroing the balance first", async () => {
    const r = await run([
      publish(1, 0, 0, PRICE),
      {
        name: "buy",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { emits: "Purchased" },
      },
      { name: "withdraw", call: "withdraw", args: [NATIVE], expect: { emits: "Withdrawn" } },
      pending(NATIVE, "$OWNER", "0"),
      {
        name: "nothing left",
        call: "withdraw",
        args: [NATIVE],
        expect: { reverts: "Nothing to withdraw" },
      },
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("gives a free listing to everyone without a purchase", async () => {
    const r = await run([
      publish(2, 0, 0, "0"),
      { name: "free is open", call: "hasAccess", args: ["0", "$OTHER"], expect: { equals: true } },
    ]);
    expect(failures(r)).toEqual([]);
  });
});

describe("DevStationMarketplace: pay per deploy", () => {
  it("charges every deploy, and lets the creator deploy free", async () => {
    const r = await run([
      publish(0, 0, 1, PRICE),
      {
        name: "one-time buy refused",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { reverts: "paid per deploy" },
      },
      {
        name: "deploy 1",
        call: "recordDeploy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { emits: "DeployRecorded" },
      },
      {
        name: "deploy 2",
        call: "recordDeploy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { emits: "DeployRecorded" },
      },
      pending(NATIVE, "$OWNER", "1900000000000000000"),
      pending(NATIVE, TREASURY, "100000000000000000"),
      {
        name: "creator deploys free",
        call: "recordDeploy",
        args: ["0"],
        value: "0",
        expect: { emits: "DeployRecorded" },
      },
      {
        name: "deployer has access",
        call: "hasAccess",
        args: ["0", "$OTHER"],
        expect: { equals: true },
      },
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("is only for contract templates", async () => {
    const r = await run([
      {
        name: "an app cannot be per-deploy",
        call: "publish",
        args: ["1", "0", "1", PRICE, "App", "", "{}", HASH],
        expect: { reverts: "Per-deploy pricing is for contract templates" },
      },
    ]);
    expect(failures(r)).toEqual([]);
  });
});

describe("DevStationMarketplace: QUSDC", () => {
  it("sells in QUSDC, splits 95/5 and withdraws in QUSDC", async () => {
    const r = await run([
      publish(3, 1, 0, USD),
      {
        name: "QIE sent to a QUSDC listing is refused",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: "1",
        expect: { reverts: "priced in QUSDC" },
      },
      {
        name: "buy in QUSDC",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        expect: { emits: "Purchased" },
      },
      pending("$TOKEN", TREASURY, "125000"),
      pending("$TOKEN", "$OWNER", "2375000"),
      {
        name: "withdraw QUSDC",
        call: "withdraw",
        args: ["$TOKEN"],
        expect: { emits: "Withdrawn" },
      },
      pending("$TOKEN", "$OWNER", "0"),
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("refuses QUSDC listings where QUSDC does not exist", async () => {
    const r = await run(
      [
        {
          name: "no QUSDC on this chain",
          call: "publish",
          args: ["0", "1", "0", USD, "Vault", "", "{}", HASH],
          expect: { reverts: "QUSDC not available here" },
        },
      ],
      { qusdc: false },
    );
    expect(failures(r)).toEqual([]);
  });
});

describe("DevStationMarketplace: tips, featuring and moderation", () => {
  it("passes tips on in full", async () => {
    const r = await run([
      publish(2, 0, 0, "0"),
      {
        name: "tip",
        call: "tip",
        args: ["0", "1000"],
        from: "$OTHER",
        value: "1000",
        expect: { emits: "Tipped" },
      },
      pending(NATIVE, "$OWNER", "1000"),
      pending(NATIVE, TREASURY, "0"),
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("sells featured days to the creator, all to the treasury", async () => {
    const r = await run([
      publish(0, 0, 0, PRICE),
      {
        name: "not open until priced",
        call: "feature",
        args: ["0", "3"],
        value: "30",
        expect: { reverts: "Featuring is not open" },
      },
      {
        name: "only the owner prices it",
        call: "setFeaturedPrice",
        args: ["0", "10"],
        from: "$OTHER",
        expect: { reverts: "Not the owner" },
      },
      {
        name: "price featuring",
        call: "setFeaturedPrice",
        args: ["0", "10"],
        expect: { emits: "FeaturedPriceSet" },
      },
      {
        name: "a stranger cannot feature it",
        call: "feature",
        args: ["0", "3"],
        from: "$OTHER",
        value: "30",
        expect: { reverts: "Not the creator" },
      },
      {
        name: "zero days refused",
        call: "feature",
        args: ["0", "0"],
        value: "0",
        expect: { reverts: "Feature for 1-90 days" },
      },
      {
        name: "feature 3 days",
        call: "feature",
        args: ["0", "3"],
        value: "30",
        expect: { emits: "Featured" },
      },
      {
        name: "3 more days stack",
        call: "feature",
        args: ["0", "3"],
        value: "30",
        expect: { emits: "Featured" },
      },
      pending(NATIVE, TREASURY, "60"),
      pending(NATIVE, "$OWNER", "0"),
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("lets only the owner hide a listing, which then cannot be bought or read", async () => {
    const r = await run([
      publish(1, 0, 0, PRICE),
      {
        name: "a stranger cannot moderate",
        call: "moderate",
        args: ["0", true],
        from: "$OTHER",
        expect: { reverts: "Not the owner" },
      },
      { name: "hide", call: "moderate", args: ["0", true], expect: { emits: "Moderated" } },
      {
        name: "hidden cannot be bought",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { reverts: "Listing not available" },
      },
      {
        name: "hidden cannot be read",
        call: "hasAccess",
        args: ["0", "$OTHER"],
        expect: { equals: false },
      },
    ]);
    expect(failures(r)).toEqual([]);
  });

  it("lets only the creator update, and needs a content hash", async () => {
    const r = await run([
      publish(0, 0, 0, PRICE),
      {
        name: "a stranger cannot update",
        call: "update",
        args: ["0", "0", false, "{}"],
        from: "$OTHER",
        expect: { reverts: "Not the creator" },
      },
      {
        name: "creator unlists",
        call: "update",
        args: ["0", PRICE, false, "{}"],
        expect: { emits: "ListingUpdated" },
      },
      {
        name: "unlisted cannot be bought",
        call: "buy",
        args: ["0"],
        from: "$OTHER",
        value: PRICE,
        expect: { reverts: "Listing not available" },
      },
      {
        name: "empty hash refused",
        call: "publish",
        args: ["0", "0", "0", PRICE, "Vault", "", "{}", `0x${"00".repeat(32)}`],
        expect: { reverts: "Content hash required" },
      },
    ]);
    expect(failures(r)).toEqual([]);
  });
});
