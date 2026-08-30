import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runSuite } from "@/lib/testing/runner";

// TemplateRegistry exercised in the same in-process EVM the agent uses, pinned
// to Shanghai — the hardfork QIE actually runs. Testing under a later fork
// could pass code that reverts on-chain.

const artifact = JSON.parse(readFileSync("contracts/out/TemplateRegistry.json", "utf8")) as {
  abi: unknown[];
  bytecode: string;
};

const TREASURY = "0x00000000000000000000000000000000000000fe";
const PRICE = "1000000000000000000"; // 1 QIE

async function run(tests: unknown[]) {
  return runSuite({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    suite: { deploy: [], deployArgs: [TREASURY], tests } as never,
  } as never);
}

const publish = {
  name: "publishes a template",
  call: "publish",
  args: ["Vault", "A vault", "contract Vault {}", "[]", PRICE],
  expect: { emits: "TemplatePublished" },
};

describe("TemplateRegistry", () => {
  it("publishes and counts it", async () => {
    const r = await run([
      publish,
      { name: "counts one", call: "totalTemplates", args: [], expect: { equals: "1" } },
    ]);
    expect(
      r.outcomes.filter((o) => !o.passed).map((o) => o.name + ": " + (o.detail ?? "")),
    ).toEqual([]);
  });

  it("refuses a deploy that underpays", async () => {
    const r = await run([
      publish,
      {
        name: "underpay reverts",
        call: "deployWithTemplate",
        args: ["0"],
        value: "1",
        expect: { reverts: "Insufficient payment" },
      },
    ]);
    expect(
      r.outcomes.filter((o) => !o.passed).map((o) => o.name + ": " + (o.detail ?? "")),
    ).toEqual([]);
  });

  it("splits payment 95/5", async () => {
    const r = await run([
      publish,
      {
        name: "pay the price",
        call: "deployWithTemplate",
        args: ["0"],
        value: PRICE,
        expect: { emits: "TemplateDeployed" },
      },
      {
        name: "treasury credited 5%",
        call: "pending",
        args: [TREASURY],
        expect: { equals: "50000000000000000" },
      },
    ]);
    expect(
      r.outcomes.filter((o) => !o.passed).map((o) => o.name + ": " + (o.detail ?? "")),
    ).toEqual([]);
  });

  it("only the creator may change price or delist", async () => {
    const r = await run([
      publish,
      {
        name: "stranger cannot update",
        call: "update",
        args: ["0", "0", false],
        from: "$OTHER",
        expect: { reverts: "Not the creator" },
      },
    ]);
    expect(
      r.outcomes.filter((o) => !o.passed).map((o) => o.name + ": " + (o.detail ?? "")),
    ).toEqual([]);
  });

  it("refuses a withdrawal when nothing is owed", async () => {
    const r = await run([
      publish,
      {
        name: "nothing to withdraw",
        call: "withdraw",
        args: [],
        from: "$OTHER",
        expect: { reverts: "Nothing to withdraw" },
      },
    ]);
    expect(
      r.outcomes.filter((o) => !o.passed).map((o) => o.name + ": " + (o.detail ?? "")),
    ).toEqual([]);
  });

  it("refuses a deploy of a delisted template", async () => {
    const r = await run([
      publish,
      {
        name: "delist",
        call: "update",
        args: ["0", PRICE, false],
        expect: { emits: "TemplateUpdated" },
      },
      {
        name: "delisted cannot be deployed",
        call: "deployWithTemplate",
        args: ["0"],
        value: PRICE,
        expect: { reverts: "Template not available" },
      },
    ]);
    expect(
      r.outcomes.filter((o) => !o.passed).map((o) => o.name + ": " + (o.detail ?? "")),
    ).toEqual([]);
  });
});
