// Behaviour tests for the v2 contracts (contracts/V2_CHANGES.md): each fix is
// exercised against the committed artifact, alongside the v1 rules it keeps.
import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import solc from "solc";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Abi } from "viem";
import marketV2 from "../out/DevStationMarketplaceV2.json";
import labelV2 from "../out/ContractLabelRegistryV2.json";
import {
  BUYER,
  CREATOR,
  ETHER,
  HASH,
  LABELER,
  OWNER,
  TREASURY,
  chainlet,
  type Chainlet,
} from "./chainlet";

const mAbi = marketV2.abi as Abi;
const mBin = marketV2.bytecode as `0x${string}`;
const lAbi = labelV2.abi as Abi;
const lBin = labelV2.bytecode as `0x${string}`;
const ZERO = "0x0000000000000000000000000000000000000000";
const NEW_HASH = `0x${"cd".repeat(32)}` as const;
const MULTISIG = "0x6666666666666666666666666666666666666666";

// kind, currency, model, price, name, description, metadataJson, contentHash
const publishArgs = (model: number, price: bigint, currency = 0) => [
  0,
  currency,
  model,
  price,
  "Token",
  "An ERC20",
  "{}",
  HASH,
];

let tokens: {
  TestToken: { abi: Abi; bin: `0x${string}` };
  FeeToken: { abi: Abi; bin: `0x${string}` };
};
beforeAll(() => {
  const source = readFileSync(join(import.meta.dirname, "fixtures", "TestTokens.sol"), "utf8");
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources: { "TestTokens.sol": { content: source } },
        settings: {
          evmVersion: "shanghai",
          outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
        },
      }),
    ),
  );
  const pick = (n: string) => ({
    abi: out.contracts["TestTokens.sol"][n].abi as Abi,
    bin: `0x${out.contracts["TestTokens.sol"][n].evm.bytecode.object}` as `0x${string}`,
  });
  tokens = { TestToken: pick("TestToken"), FeeToken: pick("FeeToken") };
});

describe("DevStationMarketplaceV2", () => {
  let c: Chainlet;
  let market: string;

  beforeEach(async () => {
    c = await chainlet();
    market = await c.deploy(mAbi, mBin, [TREASURY, ZERO]);
    await c.call(market, mAbi, "publish", publishArgs(0, ETHER), { from: CREATOR }); // 0: one-time
    await c.call(market, mAbi, "publish", publishArgs(1, ETHER), { from: CREATOR }); // 1: per deploy
  });

  it("reports its version", async () => {
    expect((await c.call(market, mAbi, "version", [])).result).toBe(2n);
  });

  it("refuses to charge more than the buyer agreed to", async () => {
    await c.call(market, mAbi, "update", [0n, 2n * ETHER, true, "{}"], { from: CREATOR });
    const stale = await c.call(market, mAbi, "buyAt", [0n, ETHER], {
      from: BUYER,
      value: 2n * ETHER,
    });
    expect(stale.ok).toBe(false);
    expect(stale.revert).toBe("Price changed");
    const ok = await c.call(market, mAbi, "buyAt", [0n, 2n * ETHER], {
      from: BUYER,
      value: 2n * ETHER,
    });
    expect(ok.ok).toBe(true);
  });

  it("keeps the v1 entry points, still taking exactly the price", async () => {
    expect((await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER })).ok).toBe(true);
    const split = (await c.call(market, mAbi, "pending", [ZERO, CREATOR])).result as bigint;
    expect(split).toBe((ETHER * 95n) / 100n);
  });

  it("records the version a buyer paid for, whatever the listing points at later", async () => {
    await c.call(market, mAbi, "buyAt", [0n, ETHER], { from: BUYER, value: ETHER });
    await c.call(market, mAbi, "updateContent", [0n, NEW_HASH], { from: CREATOR });
    expect((await c.call(market, mAbi, "purchasedContentHash", [0n, BUYER])).result).toBe(HASH);
    expect((await c.call(market, mAbi, "purchasedContentHash", [0n, OWNER])).result).toBe(
      `0x${"00".repeat(32)}`,
    );
  });

  it("moderation stops new sales but never takes away what a buyer paid for", async () => {
    await c.call(market, mAbi, "buyAt", [0n, ETHER], { from: BUYER, value: ETHER });
    expect((await c.call(market, mAbi, "moderate", [0n, true])).ok).toBe(true);
    expect((await c.call(market, mAbi, "hasAccess", [0n, BUYER])).result).toBe(true);
    expect((await c.call(market, mAbi, "hasAccess", [0n, OWNER])).result).toBe(false);
    const late = await c.call(market, mAbi, "buyAt", [0n, ETHER], { from: OWNER, value: ETHER });
    expect(late.ok).toBe(false);
  });

  it("does not count a creator's own deploys", async () => {
    await c.call(market, mAbi, "recordDeployAt", [1n, 0n], { from: CREATOR });
    await c.call(market, mAbi, "recordDeployAt", [1n, 0n], { from: CREATOR });
    await c.call(market, mAbi, "recordDeployAt", [1n, ETHER], { from: BUYER, value: ETHER });
    const l = (await c.call(market, mAbi, "getListing", [1n])).result as { deploys: bigint };
    expect(l.deploys).toBe(1n);
  });

  it("moves the treasury in two steps, and only the new address can accept", async () => {
    expect((await c.call(market, mAbi, "transferTreasury", [MULTISIG], { from: BUYER })).ok).toBe(
      false,
    );
    expect((await c.call(market, mAbi, "transferTreasury", [MULTISIG])).ok).toBe(true);
    expect((await c.call(market, mAbi, "acceptTreasury", [], { from: BUYER })).ok).toBe(false);
    // Still the old treasury until accepted.
    expect(String((await c.call(market, mAbi, "treasury", [])).result).toLowerCase()).toBe(
      TREASURY,
    );
    expect((await c.call(market, mAbi, "acceptTreasury", [], { from: MULTISIG })).ok).toBe(true);
    await c.call(market, mAbi, "buyAt", [0n, ETHER], { from: BUYER, value: ETHER });
    expect((await c.call(market, mAbi, "pending", [ZERO, MULTISIG])).result).toBe(ETHER / 20n);
    expect((await c.call(market, mAbi, "pending", [ZERO, TREASURY])).result).toBe(0n);
  });

  it("refuses to feature for more than the agreed cost", async () => {
    await c.call(market, mAbi, "setFeaturedPrice", [0, ETHER]);
    const tooMuch = await c.call(market, mAbi, "featureAt", [0n, 2n, ETHER], {
      from: CREATOR,
      value: 2n * ETHER,
    });
    expect(tooMuch.revert).toBe("Price changed");
    expect(
      (
        await c.call(market, mAbi, "featureAt", [0n, 2n, 2n * ETHER], {
          from: CREATOR,
          value: 2n * ETHER,
        })
      ).ok,
    ).toBe(true);
  });

  async function qusdcMarket(kind: "TestToken" | "FeeToken") {
    const t = tokens[kind];
    const token = await c.deploy(t.abi, t.bin, []);
    const m = await c.deploy(mAbi, mBin, [TREASURY, token]);
    await c.call(m, mAbi, "publish", publishArgs(0, 1_000_000n, 1), { from: CREATOR });
    await c.call(token, t.abi, "mint", [BUYER, 10_000_000n]);
    await c.call(token, t.abi, "approve", [m, 1_000_000n], { from: BUYER });
    return { m, token, t };
  }

  it("takes QUSDC in full and pays it out", async () => {
    const { m, token, t } = await qusdcMarket("TestToken");
    expect((await c.call(m, mAbi, "buyAt", [0n, 1_000_000n], { from: BUYER })).ok).toBe(true);
    expect((await c.call(m, mAbi, "withdraw", [token], { from: CREATOR })).ok).toBe(true);
    expect((await c.call(token, t.abi, "balanceOf", [CREATOR])).result).toBe(950_000n);
  });

  it("keeps a per-deploy buyer's hash on the version they last paid for", async () => {
    await c.call(market, mAbi, "recordDeployAt", [1n, ETHER], { from: BUYER, value: ETHER });
    await c.call(market, mAbi, "updateContent", [1n, NEW_HASH], { from: CREATOR });
    expect((await c.call(market, mAbi, "purchasedContentHash", [1n, BUYER])).result).toBe(HASH);
    await c.call(market, mAbi, "recordDeployAt", [1n, ETHER], { from: BUYER, value: ETHER });
    expect((await c.call(market, mAbi, "purchasedContentHash", [1n, BUYER])).result).toBe(NEW_HASH);
  });

  it("closes a free listing to new downloads once its creator deactivates it", async () => {
    await c.call(market, mAbi, "publish", publishArgs(0, 0n), { from: CREATOR }); // 2: free
    expect((await c.call(market, mAbi, "hasAccess", [2n, BUYER])).result).toBe(true);
    await c.call(market, mAbi, "update", [2n, 0n, false, "{}"], { from: CREATOR });
    expect((await c.call(market, mAbi, "hasAccess", [2n, BUYER])).result).toBe(false);
    expect((await c.call(market, mAbi, "hasAccess", [2n, CREATOR])).result).toBe(true);
  });

  it("lets the owner withdraw a treasury proposal before it is accepted", async () => {
    expect((await c.call(market, mAbi, "cancelTreasuryTransfer", [])).revert).toBe(
      "No pending treasury",
    );
    await c.call(market, mAbi, "transferTreasury", [MULTISIG]);
    expect((await c.call(market, mAbi, "cancelTreasuryTransfer", [], { from: BUYER })).ok).toBe(
      false,
    );
    expect((await c.call(market, mAbi, "cancelTreasuryTransfer", [])).ok).toBe(true);
    expect((await c.call(market, mAbi, "acceptTreasury", [], { from: MULTISIG })).ok).toBe(false);
  });

  it("explains a QUSDC address with no contract behind it", async () => {
    const m = await c.deploy(mAbi, mBin, [TREASURY, "0x000000000000000000000000000000000000dEaD"]);
    await c.call(m, mAbi, "publish", publishArgs(0, 1_000_000n, 1), { from: CREATOR });
    const r = await c.call(m, mAbi, "buyAt", [0n, 1_000_000n], { from: BUYER });
    expect(r.revert).toBe("QUSDC not available here");
  });

  it("refuses a token that delivers less than it was asked for", async () => {
    const { m } = await qusdcMarket("FeeToken");
    const r = await c.call(m, mAbi, "buyAt", [0n, 1_000_000n], { from: BUYER });
    expect(r.ok).toBe(false);
    expect(r.revert).toBe("Token delivered less than the amount");
  });
});

describe("ContractLabelRegistryV2", () => {
  const TARGET = "0x9999999999999999999999999999999999999999";
  let c: Chainlet;
  let reg: string;

  beforeEach(async () => {
    c = await chainlet();
    reg = await c.deploy(lAbi, lBin, [LABELER]);
  });

  it("lets only the owner remove a label, which frees the address", async () => {
    await c.call(reg, lAbi, "submitLabel", [TARGET, "Official Bridge", "bridge", "", false], {
      from: BUYER,
    });
    expect((await c.call(reg, lAbi, "removeLabel", [TARGET], { from: CREATOR })).ok).toBe(false);
    expect((await c.call(reg, lAbi, "removeLabel", [TARGET])).ok).toBe(true);
    expect((await c.call(reg, lAbi, "getLabelName", [TARGET])).result).toBe("");
    expect((await c.call(reg, lAbi, "totalLabels", [])).result).toBe(0n);
    // Anyone may label it again, and it is listed once.
    expect(
      (
        await c.call(reg, lAbi, "submitLabel", [TARGET, "Real", "token", "", false], {
          from: CREATOR,
        })
      ).ok,
    ).toBe(true);
    const page = (await c.call(reg, lAbi, "getLabeledContractsPage", [0n, 10n])).result as string[];
    expect(page.length).toBe(1);
  });

  it("caps label text", async () => {
    const long = "x".repeat(81);
    const r = await c.call(reg, lAbi, "submitLabel", [TARGET, long, "token", "", false], {
      from: BUYER,
    });
    expect(r.revert).toBe("Name too long");
  });

  it("keeps the auto-label restriction from v1", async () => {
    const r = await c.call(reg, lAbi, "submitLabel", [TARGET, "Mine", "token", "", true], {
      from: BUYER,
    });
    expect(r.revert).toBe("Not authorized to auto-label");
  });

  it("moves ownership in two steps", async () => {
    expect((await c.call(reg, lAbi, "transferOwnership", [MULTISIG])).ok).toBe(true);
    expect((await c.call(reg, lAbi, "acceptOwnership", [], { from: BUYER })).ok).toBe(false);
    expect((await c.call(reg, lAbi, "acceptOwnership", [], { from: MULTISIG })).ok).toBe(true);
    expect(String((await c.call(reg, lAbi, "owner", [])).result).toLowerCase()).toBe(MULTISIG);
  });
});
